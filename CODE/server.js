require('dotenv').config({ quiet: true });

const express = require('express');
const sql = require('mssql');
const session = require('express-session');
const cors = require('cors');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');


// ==========================================================
// EXPRESS APP
// ==========================================================
const app = express();

app.use(cors());

app.use(express.json());

// ==========================================================
// SESSION SECRET — persists across local development restarts.
// If SESSION_SECRET is configured, always use it.
// Production deliberately REQUIRES SESSION_SECRET to be configured.
// For local development only, create a strong random secret once
// outside the publicly served project directory.
// ==========================================================
const crypto = require('crypto');
const os = require('os');

function loadSessionSecret() {
    const configured = process.env.SESSION_SECRET;
    if (typeof configured === 'string' && configured.trim()) {
        return configured;
    }

    if (process.env.NODE_ENV === 'production') {
        throw new Error(
            'SESSION_SECRET must be configured before starting in production.'
        );
    }

    // Each project folder receives its own persistent local secret.
    const projectId = crypto.createHash('sha256')
        .update(path.resolve(__dirname))
        .digest('hex')
        .slice(0, 16);

    const privateDir = path.join(os.homedir(), '.fostercare-connect');
    const secretFile = path.join(privateDir, `session-${projectId}.secret`);
    fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });

    try {
        const savedSecret = fs.readFileSync(secretFile, 'utf8').trim();
        if (savedSecret.length >= 32) return savedSecret;
        throw new Error(`Invalid local session secret file: ${secretFile}`);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const generatedSecret = crypto.randomBytes(48).toString('hex');
    try {
        fs.writeFileSync(secretFile, generatedSecret, {
            encoding: 'utf8', flag: 'wx', mode: 0o600
        });
        console.log('Created a persistent local-development session secret.');
        return generatedSecret;
    } catch (error) {
        // Another instance may have created the same file concurrently.
        if (error.code === 'EEXIST') {
            const concurrentSecret = fs.readFileSync(secretFile, 'utf8').trim();
            if (concurrentSecret.length >= 32) return concurrentSecret;
        }
        throw error;
    }
}

const sessionSecret = loadSessionSecret();

// Login session configuration
app.use(session({
    name: 'fostercare.sid',

    secret: sessionSecret,

    resave: false,

    saveUninitialized: false,

    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 2
    }
}));

// Closed accounts must not continue using sessions opened in another browser.
app.use('/api', async (req, res, next) => {
    const personId = Number(req.session?.user?.personId);
    if (!Number.isSafeInteger(personId) || personId <= 0) return next();
    try {
        const pool = await getPool();
        const result = await pool.request().input('id', sql.Int, personId)
            .query('SELECT Status FROM dbo.PERSON WHERE PersonID = @id');
        if (result.recordset[0]?.Status === 'Active') return next();
        return req.session.destroy(() => {
            res.clearCookie('fostercare.sid');
            res.status(401).json({ error: 'This account is no longer active. Please log in again.' });
        });
    } catch (error) {
        console.error('Session account status check:', error);
        return res.status(503).json({ error: 'Unable to verify account status.' });
    }
});

// Open the existing login page at http://localhost:3000/
app.get('/', (req, res) => res.redirect('/login.html'));

app.use(express.static(__dirname));
// ===========================================
// AUTHENTICATION AND ROLE PROTECTION
// ===========================================

function requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            error: 'Please log in first.'
        });
    }

    next();
}

function requireAgencyManager(req, res, next) {
    const role = req.session?.user?.role;

    if (
        typeof role !== 'string' ||
        role.trim().toLowerCase() !== 'agency manager'
    ) {
        return res.status(403).json({
            error: 'Access denied. Agency Manager only.'
        });
    }

    next();
}
function requireAdmin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            error: 'Please log in first.'
        });
    }

    const role = req.session.user.role;

    if (typeof role !== 'string' ||
        role.trim().toLowerCase() !== 'admin') {
        return res.status(403).json({
            error: 'Access denied. Administrator only.'
        });
    }

    next();
}
function requireSocialWorker(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            error: 'Please log in first.'
        });
    }

    const role = req.session.user.role;

    if (
        typeof role !== 'string' ||
        role.trim().toLowerCase() !== 'social worker'
    ) {
        return res.status(403).json({
            error: 'Access denied. Social Worker only.'
        });
    }

    next();
}



function requireBiologicalParent(req, res, next) {

    const role = req.session?.user?.role;

    if (!role || role.trim().toLowerCase() !== 'biological parent') {
        return res.status(403).json({
            error: 'Access denied. Biological Parent only.'
        });
    }

    next();
}

function requireOwnProfile(req, res, next) {
    const loggedInId = Number(req.session.user.personId);
    const requestedId = Number(req.params.personId);

    if (
        !Number.isSafeInteger(requestedId) ||
        loggedInId !== requestedId
    ) {
        return res.status(403).json({
            error: 'You can only access your own profile.'
        });
    }

    next();
}
// ===========================================
// BIOLOGICAL PARENT OWNERSHIP CHECK
// ===========================================

function requireOwnParentAccount(req, res, next) {

    const loggedInId = Number(req.session.user.personId);
    const requestedId = Number(req.params.personId);

    if (
        !Number.isSafeInteger(requestedId) ||
        loggedInId !== requestedId
    ) {
        return res.status(403).json({
            error: 'You cannot access another parent account.'
        });
    }

    next();
}
// ==========================================================
// FILE UPLOADS
// ==========================================================

// Where uploaded documents get saved on your computer
const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

const upload = multer({
    dest: uploadsDir
});

// Documents are served through authenticated routes below, not a public static directory.


// ==========================================================
// DATABASE CONFIGURATION
// ==========================================================

const dbConfig = {
    server: 'localhost',
    port: 1433,
    database: 'FOSTERCARE',
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    options: {
        enableArithAbort: true,
        trustServerCertificate: true,
        encrypt: false,
        connectTimeout: 30000
    }
};


// ==========================================================
// DATABASE CONNECTION
// ==========================================================

async function getPool() {
    return await sql.connect(dbConfig);
}


// ==========================================================
// AUDIT LOG HELPER
// ==========================================================

async function logEvent(pool, personId, eventAction, ipAddress) {
    try {
        await pool.request()
            .input('personId', sql.Int, personId || null)
            .input('eventAction', sql.VarChar, eventAction)
            .input('ipAddress', sql.VarChar, ipAddress || 'Unknown')
            .query(`
                INSERT INTO AUDIT_LOGS (
                    PersonID,
                    EventAction,
                    IPAddress
                )
                VALUES (
                    @personId,
                    @eventAction,
                    @ipAddress
                )
            `);
    } catch (err) {
        console.error(
            'Failed to write audit log:',
            err.message
        );
    }
}


// ==========================================================
// NOTIFICATION HELPER
// ==========================================================

async function notify(
    pool,
    recipientId,
    senderId,
    eventType,
    message,
    relatedTable,
    relatedId
) {
    try {
        await pool.request()
            .input('recipientId', sql.Int, recipientId)
            .input('senderId', sql.Int, senderId || null)
            .input('eventType', sql.VarChar, eventType)
            .input('message', sql.VarChar, message)
            .input(
                'relatedTable',
                sql.VarChar,
                relatedTable || null
            )
            .input(
                'relatedId',
                sql.Int,
                relatedId || null
            )
            .query(`
                INSERT INTO NOTIFICATIONS (
                    RecipientID,
                    SenderID,
                    EventType,
                    Message,
                    RelatedTable,
                    RelatedID
                )
                VALUES (
                    @recipientId,
                    @senderId,
                    @eventType,
                    @message,
                    @relatedTable,
                    @relatedId
                )
            `);

    } catch (err) {
        console.error(
            'Failed to write notification:',
            err.message
        );
    }
}



// District contact matching: derived from the parent's saved location.
// Does NOT reassign existing child cases or placement approvals.
function locationParts(value) {
    const pieces = String(value || '').split('|').map(x => x.trim());
    return pieces.length === 3 && pieces.every(Boolean) ? pieces : null;
}
async function districtContact(pool, parentId) {
    // Read the biological parent's CURRENT saved profile location on every request.
    const parentResult = await pool.request()
        .input('id', sql.Int, parentId)
        .query('SELECT RegionDistrict FROM PERSON WHERE PersonID = @id');
    if (!parentResult.recordset.length) return null;
    const parentParts = locationParts(parentResult.recordset[0].RegionDistrict);
    if (!parentParts) return null;

    // Fetch only ACTIVE social workers. Never fall back to a different district.
    const workers = await pool.request().query(`
        SELECT sw.PersonID, sw.FullName, sw.Email, sw.Phone, sw.RegionDistrict
        FROM PERSON sw
        JOIN ROLES r ON r.RoleID = sw.RoleID
        WHERE r.RoleName = 'Social Worker' AND sw.Status = 'Active'
        ORDER BY sw.PersonID
    `);
    const normalize = value => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
    const matches = workers.recordset.filter(worker => {
        const parts = locationParts(worker.RegionDistrict);
        return parts && normalize(parts[0]) === normalize(parentParts[0])
            && normalize(parts[1]) === normalize(parentParts[1]);
    });
    // Prefer the social worker in the same town when more than one serves a district.
    const selected = matches.find(worker => {
        const parts = locationParts(worker.RegionDistrict);
        return normalize(parts[2]) === normalize(parentParts[2]);
    }) || matches[0];
    if (!selected) return null;
    return { FullName: selected.FullName, Email: selected.Email, Phone: selected.Phone };
}
// Child has no province column: derive it from its biological parent's saved location.
async function sameProvincePlacement(transaction, childId, fosterParentId) {
    const result = await new sql.Request(transaction)
        .input('childId', sql.Int, childId)
        .input('fosterId', sql.Int, fosterParentId)
        .query(`SELECT bp.RegionDistrict AS ChildLocation,
                       fp.RegionDistrict AS FosterLocation
                FROM CHILD c
                JOIN PERSON bp ON bp.PersonID = c.BiologicalParentID
                JOIN PERSON fp ON fp.PersonID = @fosterId
                WHERE c.ChildID = @childId`);
    const row = result.recordset[0];
    const child = locationParts(row?.ChildLocation);
    const foster = locationParts(row?.FosterLocation);
    return !!(child && foster && child[0].toLowerCase() === foster[0].toLowerCase());
}

/* ==========================================================
   LOGIN
   ========================================================== */

app.post('/api/login', async (req, res) => {

    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            error: 'Email and password are required.'
        });
    }

    const cleanEmail = email.trim().toLowerCase();

    try {

        const pool = await getPool();

        const result = await pool.request()
            .input('email', sql.VarChar, cleanEmail)
            .query(`
                  SELECT
    p.PersonID,
    p.FullName,
    p.Email,
    p.PasswordHash,
    p.Status,
    p.ProfessionalRegNo,
    r.RoleName
                FROM PERSON p
                JOIN ROLES r
                    ON p.RoleID = r.RoleID
                WHERE p.Email = @email
            `);

        if (result.recordset.length === 0) {
            return res.status(401).json({
                error: 'Invalid email or password.'
            });
        }

        const user = result.recordset[0];

        if (user.Status !== 'Active') {
            return res.status(403).json({
                error:
                    'This account is not active. Contact an administrator.'
            });
        }

        const passwordMatches = await bcrypt.compare(
            password,
            user.PasswordHash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                error: 'Invalid email or password.'
            });
        }

      // Create a new authenticated session
req.session.regenerate((sessionError) => {

    if (sessionError) {
        console.error('Session error:', sessionError);

        return res.status(500).json({
            error: 'Could not create login session.'
        });
    }

    // Store authenticated user information on the server
    req.session.user = {
        personId: user.PersonID,
        fullName: user.FullName,
        email: user.Email,
        role: user.RoleName
    };

    req.session.save(async (saveError) => {

        if (saveError) {
            console.error('Session save error:', saveError);

            return res.status(500).json({
                error: 'Could not save login session.'
            });
        }

        await logEvent(
            pool,
            user.PersonID,
            'Successful login',
            req.ip
        );

        // Preserve the existing login response
        res.json({
            personId: user.PersonID,
            fullName: user.FullName,
            email: user.Email,
            role: user.RoleName
        });
    });
});

    } catch (err) {

        console.error(
            'Login error:',
            err
        );

        res.status(500).json({
            error:
                'Server error during login.'
        });
    }
});
/* ==========================================================
   GENERIC PROFILE
   ========================================================== */

app.get(
    '/api/profile/:personId',
    requireAuth,
    requireOwnProfile,
    async (req, res) => {

    try {

        const pool = await getPool();

        const result = await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.personId
            )
            .query(`
                SELECT
                    p.FullName,
                    p.Email,
                    p.ProfessionalRegNo,
                    p.RegionDistrict,
                    p.Phone,
                    r.RoleName
                FROM PERSON p
                JOIN ROLES r
                    ON p.RoleID = r.RoleID
                WHERE p.PersonID = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                error: 'Not found'
            });
        }

        res.json(result.recordset[0]);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.put(
    '/api/profile/:personId',
    requireAuth,
    requireOwnProfile,
    async (req, res) => {

    const {
        fullName,
        email,
        professionalRegNo,
        regionDistrict,
        phone
    } = req.body;

    try {

        const pool = await getPool();

        await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.personId
            )
            .input(
                'fullName',
                sql.VarChar,
                fullName
            )
            .input(
                'email',
                sql.VarChar,
                email
            )
            .input(
                'regNo',
                sql.VarChar,
                professionalRegNo || null
            )
            .input(
                'region',
                sql.VarChar,
                regionDistrict || null
            )
            .input(
                'phone',
                sql.VarChar,
                phone || null
            )
            .query(`
                UPDATE PERSON
                SET
                    FullName = @fullName,
                    Email = @email,
                    ProfessionalRegNo = @regNo,
                    RegionDistrict = @region,
                    Phone = @phone
                WHERE PersonID = @id
            `);

        await logEvent(
            pool,
            req.params.personId,
            'Updated own profile',
            req.ip
        );

        res.json({
            success: true
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});
/* ==========================================================
   ADMIN DASHBOARD
   ========================================================== */

app.get('/api/admin/stats', requireAuth, requireAdmin, async (req, res) => {
    try {
        const pool = await getPool();

        const activeUsers = await pool.request()
            .query(`
                SELECT COUNT(*) AS count
                FROM PERSON
                WHERE Status = 'Active'
            `);

        res.json({
            activeUsers: activeUsers.recordset[0].count,
            databaseOnline: true,
            securityWarnings: 0
        });

    } catch (err) {
        console.error(err);

        res.json({
            activeUsers: 0,
            databaseOnline: false,
            securityWarnings: 0
        });
    }
});


app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const pool = await getPool();

        const result = await pool.request()
            .query(`
                SELECT
                    p.PersonID,
                    p.FullName,
                    p.Email,
                    p.Phone,
                    p.RegionDistrict,
                    p.Status,
                    r.RoleName
                FROM PERSON p
                JOIN ROLES r
                    ON p.RoleID = r.RoleID
                ORDER BY p.FullName
            `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


/* ==========================================================
   ADMIN: EDIT EXISTING USER (location, name, email, phone)
   Role, password and account status remain unchanged.
   ========================================================== */
app.put('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const personId = Number(req.params.id);
    const { fullName, email, phone, regionDistrict } = req.body || {};

    if (!Number.isSafeInteger(personId) || personId <= 0) {
        return res.status(400).json({ error: 'Invalid user ID.' });
    }
    if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 200 ||
        typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254 ||
        (phone != null && (typeof phone !== 'string' || phone.length > 50)) ||
        (regionDistrict != null && (typeof regionDistrict !== 'string' || regionDistrict.length > 255))) {
        return res.status(400).json({ error: 'Enter a valid name, email, phone and location.' });
    }

    try {
        const pool = await getPool();
        const existing = await pool.request()
            .input('id', sql.Int, personId)
            .query('SELECT PersonID, Email, RegionDistrict FROM PERSON WHERE PersonID = @id');
        if (!existing.recordset.length) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const duplicate = await pool.request()
            .input('id', sql.Int, personId)
            .input('email', sql.VarChar(254), normalizedEmail)
            .query('SELECT PersonID FROM PERSON WHERE Email = @email AND PersonID <> @id');
        if (duplicate.recordset.length) {
            return res.status(409).json({ error: 'Another account already uses this email.' });
        }

        const result = await pool.request()
            .input('id', sql.Int, personId)
            .input('fullName', sql.VarChar(200), fullName.trim())
            .input('email', sql.VarChar(254), normalizedEmail)
            .input('phone', sql.VarChar(50), (phone || '').trim() || null)
            .input('region', sql.VarChar(255), (regionDistrict || '').trim() || null)
            .query(`
                UPDATE PERSON
                SET FullName = @fullName,
                    Email = @email,
                    Phone = @phone,
                    RegionDistrict = @region
                WHERE PersonID = @id
            `);
        if (result.rowsAffected[0] !== 1) {
            return res.status(404).json({ error: 'User not found.' });
        }

        // If an administrator edits their own account, keep their session in sync.
        if (Number(req.session.user.personId) === personId) {
            req.session.user.fullName = fullName.trim();
            req.session.user.email = normalizedEmail;
        }

        await logEvent(pool, Number(req.session.user.personId),
            `Updated user #${personId} profile/location`, req.ip);

        return res.json({ success: true, personId, message: 'User updated successfully.' });
    } catch (err) {
        console.error('Admin edit user error:', err);
        if (err.number === 2601 || err.number === 2627) {
            return res.status(409).json({ error: 'That email is already in use.' });
        }
        return res.status(500).json({ error: 'Could not update user. Check the server log.' });
    }
});

// Administrator account deletion. SQL Server enforces case-record retention via foreign keys.
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
    const personId = Number(req.params.id);
    const adminId = Number(req.session?.user?.personId);
    if (!Number.isSafeInteger(personId) || personId <= 0) {
        return res.status(400).json({ error: 'Invalid account ID.' });
    }
    if (personId === adminId) {
        return res.status(403).json({ error: 'You cannot delete your own active administrator account.' });
    }
    if (req.body?.confirmation !== 'DELETE') {
        return res.status(400).json({ error: 'Deletion confirmation is required.' });
    }

    let transaction;
    try {
        const pool = await getPool();
        const target = await pool.request()
            .input('id', sql.Int, personId)
            .query('SELECT PersonID, FullName, Email FROM dbo.PERSON WHERE PersonID = @id');
        if (!target.recordset.length) {
            return res.status(404).json({ error: 'Account not found.' });
        }

        // Do not erase child welfare case records as a side effect of deleting a login.
        // Enumerate all direct FK references rather than assuming a fixed table list.
        const refs = await pool.request().query(`
            SELECT QUOTENAME(SCHEMA_NAME(t.schema_id)) + '.' + QUOTENAME(t.name) AS TableName,
                   QUOTENAME(c.name) AS ColumnName
            FROM sys.foreign_key_columns fkc
            JOIN sys.tables t ON t.object_id = fkc.parent_object_id
            JOIN sys.columns c ON c.object_id = fkc.parent_object_id
                AND c.column_id = fkc.parent_column_id
            JOIN sys.columns referenced ON referenced.object_id = fkc.referenced_object_id
                AND referenced.column_id = fkc.referenced_column_id
            WHERE fkc.referenced_object_id = OBJECT_ID('dbo.PERSON')
              AND referenced.name = 'PersonID'
        `);
        const blocked = [];
        for (const ref of refs.recordset) {
            const count = await pool.request()
                .input('id', sql.Int, personId)
                .query(`SELECT COUNT_BIG(*) AS Total FROM ${ref.TableName} WHERE ${ref.ColumnName} = @id`);
            if (Number(count.recordset[0].Total) > 0) {
                blocked.push({ table: ref.TableName, records: Number(count.recordset[0].Total) });
            }
        }
        if (blocked.length) {
            return res.status(409).json({
                error: 'This account is linked to existing records. Review retention and reassignment before deleting it.',
                blocked
            });
        }

        transaction = new sql.Transaction(pool);
        await transaction.begin();
        const result = await new sql.Request(transaction)
            .input('id', sql.Int, personId)
            .query('DELETE FROM dbo.PERSON WHERE PersonID = @id');
        if (result.rowsAffected[0] !== 1) {
            throw new Error('Account was not deleted.');
        }
        await transaction.commit();
        transaction = null;
        return res.json({ success: true, message: 'Account and stored password hash permanently deleted.' });
    } catch (error) {
        if (transaction) {
            try { await transaction.rollback(); } catch (_) { /* transaction may already be rolled back */ }
        }
        console.error('Admin account deletion error:', error);
        if (error.number === 547) {
            return res.status(409).json({ error: 'Other database records still reference this account. No changes were made.' });
        }
        return res.status(500).json({ error: 'Account deletion failed. No changes were saved.' });
    }
});

app.put('/api/admin/users/:id/status', requireAuth, requireAdmin, async (req, res) => {

    const { status } = req.body;

    try {
        const pool = await getPool();

        await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.id
            )
            .input(
                'status',
                sql.VarChar,
                status
            )
            .query(`
                UPDATE PERSON
                SET Status = @status
                WHERE PersonID = @id
            `);

        await logEvent(
            pool,
            null,
            `Changed user #${req.params.id} status to ${status}`,
            req.ip
        );

        res.json({
            success: true
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


// Administrator self-profile uses the same secured, phone-aware
// profile API as other roles. Keep old URL compatibility.
app.get('/api/admin/profile/:personId',
    requireAuth, requireAdmin, requireOwnProfile, async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, Number(req.params.personId))
            .query(`SELECT p.FullName, p.Email, p.ProfessionalRegNo,
                           p.Phone, p.RegionDistrict, r.RoleName
                    FROM PERSON p
                    JOIN ROLES r ON r.RoleID = p.RoleID
                    WHERE p.PersonID = @id`);
        if (!result.recordset.length)
            return res.status(404).json({error:'Profile not found.'});
        return res.json(result.recordset[0]);
    } catch (err) {
        console.error('Admin profile load error:', err);
        return res.status(500).json({error:'Could not load profile.'});
    }
});

app.put('/api/admin/profile/:personId',
    requireAuth, requireAdmin, requireOwnProfile, async (req, res) => {
    const {fullName, email, professionalRegNo, phone, regionDistrict} = req.body || {};
    if (typeof fullName !== 'string' || !fullName.trim() ||
        typeof email !== 'string' || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email.trim()) ||
        (phone != null && (typeof phone !== 'string' || phone.length > 50)) ||
        (regionDistrict != null && (typeof regionDistrict !== 'string' || regionDistrict.length > 255)))
        return res.status(400).json({error:'Enter valid profile details.'});
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, Number(req.params.personId))
            .input('fullName', sql.VarChar(200), fullName.trim())
            .input('email', sql.VarChar(254), email.trim().toLowerCase())
            .input('regNo', sql.VarChar, professionalRegNo || null)
            .input('phone', sql.VarChar(50), (phone || '').trim() || null)
            .input('region', sql.VarChar(255), (regionDistrict || '').trim() || null)
            .query(`UPDATE PERSON
                    SET FullName=@fullName, Email=@email,
                        ProfessionalRegNo=@regNo, Phone=@phone,
                        RegionDistrict=@region
                    WHERE PersonID=@id`);
        if (result.rowsAffected[0] !== 1)
            return res.status(404).json({error:'Profile not found.'});
        req.session.user.fullName = fullName.trim();
        req.session.user.email = email.trim().toLowerCase();
        await logEvent(pool, Number(req.params.personId), 'Updated own profile', req.ip);
        return res.json({success:true});
    } catch (err) {
        console.error('Admin profile save error:', err);
        return res.status(500).json({error:'Could not save profile.'});
    }
});

app.get('/api/admin/database', requireAuth, requireAdmin, async (req, res) => {
    try {
        const pool = await getPool();

        const result = await pool.request()
            .query(`
                SELECT
                    t.name AS TableName,
                    SUM(p.rows) AS [RowCount]
                FROM sys.tables t
                JOIN sys.partitions p
                    ON t.object_id = p.object_id
                    AND p.index_id IN (0,1)
                GROUP BY t.name
                ORDER BY t.name
            `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});

app.get('/api/admin/logs', requireAuth, requireAdmin, async (req, res) => {
    try {
        const pool = await getPool();

        const result = await pool.request()
            .query(`
                SELECT TOP 50
                    l.Timestamp,
                    p.Email,
                    l.EventAction,
                    l.IPAddress
                FROM AUDIT_LOGS l
                LEFT JOIN PERSON p
                    ON l.PersonID = p.PersonID
                ORDER BY l.Timestamp DESC
            `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.post('/api/admin/logs', requireAuth, requireAdmin, async (req, res) => {

    const {
        personId,
        eventAction
    } = req.body;

    try {
        const pool = await getPool();

        await logEvent(
            pool,
            personId || null,
            eventAction,
            req.ip
        );

        res.json({
            success: true
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


/* ==========================================================
   SOCIAL WORKER DASHBOARD
   ========================================================== */

app.get('/api/socialworker/stats/:personId', requireAuth, requireSocialWorker, async (req, res) => {
    try {
        const pool = await getPool();

        const personId =
            req.params.personId;


        const pendingApps =
            await pool.request()
                .query(`
                    SELECT COUNT(*) AS count
                    FROM APPLICATIONS
                    WHERE Status = 'Pending'
                `);


        const urgentPlacements =
            await pool.request()
                .input(
                    'id',
                    sql.Int,
                    personId
                )
                .query(`
                    SELECT COUNT(*) AS count
                    FROM PLACEMENT_REQUESTS
                    WHERE CaseWorkerID = @id
                    AND Priority = 'Urgent'
                    AND Status = 'Pending'
                `);


        const assignedChildren =
            await pool.request()
                .input(
                    'id',
                    sql.Int,
                    personId
                )
                .query(`
                    SELECT COUNT(*) AS count
                    FROM CHILD
                    WHERE CaseWorkerID = @id
                `);


        res.json({
            pendingApplications:
                pendingApps.recordset[0].count,

            urgentPlacements:
                urgentPlacements.recordset[0].count,

            assignedChildren:
                assignedChildren.recordset[0].count
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.get('/api/socialworker/foster-parents', requireAuth, requireSocialWorker, async (req, res) => {
    try {
        const pool = await getPool();

        const result =
            await pool.request()
                .query(`
                    SELECT
                        p.PersonID,
                        p.FullName,
                        p.Email,
                        p.Phone,
                        p.RegionDistrict,
                        fp.BackgroundCheckStatus,
                        fp.HomeEvaluationScore

                    FROM PERSON p

                    JOIN ROLES r
                        ON p.RoleID = r.RoleID

                    LEFT JOIN FOSTER_PARENT_PROFILE fp
                        ON fp.PersonID = p.PersonID

                    WHERE r.RoleName = 'Foster Parent'

                    ORDER BY p.FullName
                `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.get('/api/socialworker/biological-parents', requireAuth, requireSocialWorker, async (req, res) => {
    try {
        const pool = await getPool();

        const result =
            await pool.request()
                .query(`
                    SELECT
                        p.PersonID,
                        p.FullName,
                        p.Email

                    FROM PERSON p

                    JOIN ROLES r
                        ON p.RoleID = r.RoleID

                    WHERE r.RoleName = 'Biological Parent'

                    ORDER BY p.FullName
                `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.get('/api/socialworker/children/:personId', requireAuth, requireSocialWorker, async (req, res) => {
    try {
        const pool = await getPool();

        const result =
            await pool.request()
                .input(
                    'id',
                    sql.Int,
                    req.params.personId
                )
                .query(`
                    SELECT
                        c.ChildID,
                        c.FullName,
                        c.DateOfBirth,
                        c.CurrentPlacementStatus

                    FROM CHILD c

                    WHERE c.CaseWorkerID = @id

                    ORDER BY c.FullName
                `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.post('/api/socialworker/children', requireAuth, requireSocialWorker, async (req, res) => {

    const {
        fullName,
        dateOfBirth,
        gender,
        caseWorkerId
    } = req.body;


    if (
        !fullName ||
        !dateOfBirth ||
        !caseWorkerId
    ) {
        return res.status(400).json({
            error:
                'Full name, date of birth, and case worker are required.'
        });
    }


    try {
        const pool = await getPool();


        await pool.request()

            .input(
                'fullName',
                sql.VarChar,
                fullName
            )

            .input(
                'dob',
                sql.Date,
                dateOfBirth
            )

            .input(
                'gender',
                sql.VarChar,
                gender || null
            )

            .input(
                'caseWorkerId',
                sql.Int,
                caseWorkerId
            )

            .query(`
                INSERT INTO CHILD (
                    FullName,
                    DateOfBirth,
                    Gender,
                    CaseWorkerID
                )

                VALUES (
                    @fullName,
                    @dob,
                    @gender,
                    @caseWorkerId
                )
            `);


        await logEvent(
            pool,
            caseWorkerId,
            `Added new child record: ${fullName}`,
            req.ip
        );


        res.json({
            success: true
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});
app.get('/api/socialworker/applications/:personId', requireAuth, async (req, res) => {
        const loggedInId = Number(req.session.user.personId);
    const requestedId = Number(req.params.personId);
    const role = req.session.user.role;

    if (
        role?.trim().toLowerCase() !== 'social worker' ||
        !Number.isSafeInteger(requestedId) ||
        loggedInId !== requestedId
    ) {
        return res.status(403).json({
            error: 'Access denied. Social Worker only.'
        });
    }
    try {
        const pool = await getPool();

        const result = await pool.request().query(`
            SELECT
                a.AppID,
                p.FullName AS ApplicantName,
                a.SubmissionDate,
                a.Status
            FROM APPLICATIONS a
            JOIN PERSON p
                ON a.ApplicantPersonID = p.PersonID
            ORDER BY a.SubmissionDate DESC
        `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.put('/api/socialworker/applications/:id/status', requireAuth, requireSocialWorker, async (req, res) => {
    // Social Workers review foster parent applications.
    // Final CHILD PLACEMENT approval is handled separately by Agency Managers.
    const applicationId = Number(req.params.id);
    const reviewerId = Number(req.session.user.personId);
    const { status } = req.body || {};

    if (!Number.isSafeInteger(applicationId) || applicationId <= 0) {
        return res.status(400).json({ error: 'Invalid application ID.' });
    }

    if (!Number.isSafeInteger(reviewerId) || reviewerId <= 0) {
        return res.status(403).json({ error: 'Invalid Social Worker session.' });
    }

    if (!['Approved', 'Rejected'].includes(status)) {
        return res.status(400).json({
            error: 'Choose Approved or Rejected.'
        });
    }

    try {
        const pool = await getPool();

        // This guarded update prevents an already-reviewed application
        // from being accidentally approved or rejected a second time.
        const updateResult = await pool.request()
            .input('id', sql.Int, applicationId)
            .input('status', sql.VarChar, status)
            .input('reviewer', sql.Int, reviewerId)
            .query(`
                UPDATE APPLICATIONS
                SET Status = @status,
                    ReviewedByPersonID = @reviewer
                WHERE AppID = @id
                  AND Status = 'Pending'
            `);

        if (updateResult.rowsAffected[0] !== 1) {
            const existing = await pool.request()
                .input('id', sql.Int, applicationId)
                .query('SELECT Status FROM APPLICATIONS WHERE AppID = @id');

            if (existing.recordset.length === 0) {
                return res.status(404).json({ error: 'Application not found.' });
            }

            return res.status(409).json({
                error: 'This application has already been reviewed. Refresh the list.'
            });
        }

        const applicantResult = await pool.request()
            .input('id', sql.Int, applicationId)
            .query('SELECT ApplicantPersonID FROM APPLICATIONS WHERE AppID = @id');

        const applicantId = applicantResult.recordset[0]?.ApplicantPersonID;

        if (applicantId) {
            await notify(
                pool,
                applicantId,
                reviewerId,
                'APPLICATION_' + status.toUpperCase(),
                `Your foster parent application has been ${status.toLowerCase()}.`,
                'APPLICATIONS',
                applicationId
            );
        }

        await logEvent(
            pool,
            reviewerId,
            `Set application #${applicationId} to ${status}`,
            req.ip
        );

        return res.json({ success: true, status });

    } catch (err) {
        console.error('Review application error:', err);
        return res.status(500).json({
            error: 'Could not update this application.'
        });
    }
});

app.get(
    '/api/socialworker/biological-links/:personId',
    requireAuth,
    requireSocialWorker,
    async (req, res) => {
        const loggedInId = Number(req.session.user.personId);
        const requestedId = Number(req.params.personId);

        if (
            !Number.isSafeInteger(requestedId) ||
            requestedId <= 0 ||
            requestedId !== loggedInId
        ) {
            return res.status(403).json({
                error: 'You can only view your assigned cases.'
            });
        }

        try {
            const pool = await getPool();

            const result = await pool.request()
                .input('caseWorkerId', sql.Int, loggedInId)
                .query(`
                    SELECT
                        c.ChildID,
                        c.FullName AS ChildName,
                        bp.FullName AS ParentName,
                        c.CurrentPlacementStatus
                    FROM CHILD c
                    JOIN PERSON bp
                        ON c.BiologicalParentID = bp.PersonID
                    WHERE c.CaseWorkerID = @caseWorkerId
                    ORDER BY c.FullName
                `);

            return res.json(result.recordset);

        } catch (err) {
            console.error('Load biological links error:', err);

            return res.status(500).json({
                error: 'Could not load biological parent links.'
            });
        }
    }
);


/* ==========================================================
   SOCIAL WORKER - PLACEMENT REQUESTS
   ========================================================== */


/* ==========================================================
   GET PLACEMENT REQUESTS FOR A SOCIAL WORKER
   ========================================================== */

app.get('/api/socialworker/placements/:personId', async (req, res) => {

    try {

        const pool = await getPool();

        const result = await pool.request()

            .input(
                'caseWorkerId',
                sql.Int,
                req.params.personId
            )

            .query(`
                SELECT
                    pr.RequestID,
                    pr.ChildID,
                    c.FullName AS ChildName,

                    pr.CandidateFosterParentID,
                    fp.FullName AS FosterParentName,

                    pr.CaseWorkerID,
                    sw.FullName AS SocialWorkerName,

                    pr.Priority,
                    pr.Status,
                    pr.SubmissionDate

                FROM PLACEMENT_REQUESTS pr

                JOIN CHILD c
                    ON pr.ChildID = c.ChildID

                JOIN PERSON fp
                    ON pr.CandidateFosterParentID = fp.PersonID

                JOIN PERSON sw
                    ON pr.CaseWorkerID = sw.PersonID

                WHERE pr.CaseWorkerID = @caseWorkerId

                ORDER BY pr.SubmissionDate DESC
            `);


        res.json(result.recordset);

    } catch (err) {

        console.error(
            'Load placement requests error:',
            err
        );

        res.status(500).json({
            error: err.message
        });
    }
});


/* ==========================================================
   CREATE A PLACEMENT REQUEST
   ========================================================== */

app.post('/api/socialworker/placements', requireAuth, requireSocialWorker, async (req, res) => {

    // The logged-in Social Worker owns the request. Never trust a different
    // CaseWorkerID sent by a browser.
    const loggedInId = Number(req.session.user.personId);
    const childId = Number(req.body.childId);
    const candidateFosterParentId = Number(req.body.candidateFosterParentId);
    const caseWorkerId = Number(req.body.caseWorkerId);
    const priority = req.body.priority || 'Normal';

    if (
        !Number.isSafeInteger(loggedInId) || loggedInId <= 0 ||
        !Number.isSafeInteger(childId) || childId <= 0 ||
        !Number.isSafeInteger(candidateFosterParentId) || candidateFosterParentId <= 0 ||
        caseWorkerId !== loggedInId ||
        !['Normal', 'Urgent'].includes(priority)
    ) {
        return res.status(400).json({
            error: 'Select a valid child, foster parent, and priority for your own caseload.'
        });
    }

    let transaction;
    let transactionStarted = false;

    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
        transactionStarted = true;

        // Lock this child's record while the eligibility and placement checks run.
        const childResult = await new sql.Request(transaction)
            .input('childId', sql.Int, childId)
            .input('caseWorkerId', sql.Int, loggedInId)
            .query(`
                SELECT ChildID, CurrentPlacementStatus
                FROM CHILD WITH (UPDLOCK, HOLDLOCK)
                WHERE ChildID = @childId AND CaseWorkerID = @caseWorkerId
            `);

        if (childResult.recordset.length !== 1) {
            await transaction.rollback();
            transactionStarted = false;
            return res.status(403).json({
                error: 'This child is not assigned to the logged-in Social Worker.'
            });
        }

        if (childResult.recordset[0].CurrentPlacementStatus !== 'Unplaced') {
            await transaction.rollback();
            transactionStarted = false;
            return res.status(409).json({
                error: 'A placement request can only be created for an unplaced child.'
            });
        }

        if (!(await sameProvincePlacement(transaction, childId, candidateFosterParentId))) {
            await transaction.rollback();
            transactionStarted = false;
            return res.status(403).json({ error: 'Foster parent and child must have saved locations in the same province.' });
        }

        const fosterResult = await new sql.Request(transaction)
            .input('fosterParentId', sql.Int, candidateFosterParentId)
            .query(`
                SELECT p.PersonID, p.Status,
                       fpp.BackgroundCheckStatus, fpp.HomeEvaluationScore
                FROM PERSON p
                JOIN ROLES r ON p.RoleID = r.RoleID
                LEFT JOIN FOSTER_PARENT_PROFILE fpp ON fpp.PersonID = p.PersonID
                WHERE p.PersonID = @fosterParentId
                  AND r.RoleName = 'Foster Parent'
            `);

        const foster = fosterResult.recordset[0];
        if (
            !foster || foster.Status !== 'Active' ||
            foster.BackgroundCheckStatus !== 'Passed' ||
            foster.HomeEvaluationScore === null ||
            foster.HomeEvaluationScore === undefined
        ) {
            await transaction.rollback();
            transactionStarted = false;
            return res.status(403).json({
                error: 'Foster parent must be active, pass the background check, and complete the home evaluation.'
            });
        }

        const applicationResult = await new sql.Request(transaction)
            .input('fosterParentId', sql.Int, candidateFosterParentId)
            .query(`
                SELECT TOP 1 AppID
                FROM APPLICATIONS
                WHERE ApplicantPersonID = @fosterParentId
                  AND Status = 'Approved'
                ORDER BY SubmissionDate DESC
            `);

        if (applicationResult.recordset.length === 0) {
            await transaction.rollback();
            transactionStarted = false;
            return res.status(403).json({
                error: 'Foster parent must have an approved application before a placement request can be created.'
            });
        }

        // Prevent simultaneous submissions for the same child.
        const existingRequest = await new sql.Request(transaction)
            .input('childId', sql.Int, childId)
            .query(`
                SELECT RequestID
                FROM PLACEMENT_REQUESTS WITH (UPDLOCK, HOLDLOCK)
                WHERE ChildID = @childId AND Status IN ('Pending', 'Approved')
            `);

        if (existingRequest.recordset.length) {
            await transaction.rollback();
            transactionStarted = false;
            return res.status(409).json({
                error: 'This child already has an active placement request.'
            });
        }

        const workerResult = await new sql.Request(transaction)
            .input('caseWorkerId', sql.Int, loggedInId)
            .query(`
                SELECT RegionDistrict
                FROM PERSON
                WHERE PersonID = @caseWorkerId
            `);
        const district = workerResult.recordset[0]?.RegionDistrict || null;

        // Auto-assign to an active Agency Manager. Prefer the same district,
        // and then the manager with the fewest pending approvals.
        const managerResult = await new sql.Request(transaction)
            .input('district', sql.VarChar, district)
            .query(`
                SELECT TOP 1 p.PersonID
                FROM PERSON p
                JOIN ROLES r ON p.RoleID = r.RoleID
                LEFT JOIN APPROVALS ap
                    ON ap.ManagerPersonID = p.PersonID AND ap.Action = 'Pending'
                WHERE r.RoleName = 'Agency Manager' AND p.Status = 'Active'
                GROUP BY p.PersonID, p.RegionDistrict
                ORDER BY
                    CASE WHEN @district IS NOT NULL
                          AND p.RegionDistrict = @district THEN 0 ELSE 1 END,
                    COUNT(ap.ApprovalID),
                    p.PersonID
            `);

        if (managerResult.recordset.length === 0) {
            await transaction.rollback();
            transactionStarted = false;
            return res.status(409).json({
                error: 'Cannot submit a placement request until an active Agency Manager account exists.'
            });
        }
        const managerPersonId = managerResult.recordset[0].PersonID;

        // Create the placement and its pending approval atomically.
        const placementInsert = await new sql.Request(transaction)
            .input('childId', sql.Int, childId)
            .input('fosterParentId', sql.Int, candidateFosterParentId)
            .input('caseWorkerId', sql.Int, loggedInId)
            .input('priority', sql.VarChar, priority)
            .query(`
                INSERT INTO PLACEMENT_REQUESTS (
                    ChildID, CandidateFosterParentID, CaseWorkerID, Priority
                )
                OUTPUT INSERTED.RequestID
                VALUES (@childId, @fosterParentId, @caseWorkerId, @priority)
            `);

        const requestId = placementInsert.recordset[0].RequestID;
        const authRef = `AUTH-${requestId}`;

        // Some installations have ApprovalID as IDENTITY; others do not.
        // Handle both without modifying the user's database schema.
        const identityCheck = await new sql.Request(transaction).query(`
            SELECT COLUMNPROPERTY(
                OBJECT_ID('APPROVALS'), 'ApprovalID', 'IsIdentity'
            ) AS IsIdentity
        `);
        const isIdentity = identityCheck.recordset[0]?.IsIdentity;

        if (isIdentity !== 0 && isIdentity !== 1) {
            throw new Error('Could not determine whether APPROVALS.ApprovalID is an identity column.');
        }

        let approvalInsert;
        if (isIdentity === 1) {
            approvalInsert = await new sql.Request(transaction)
                .input('authRef', sql.VarChar, authRef)
                .input('requestId', sql.Int, requestId)
                .input('managerId', sql.Int, managerPersonId)
                .input('district', sql.VarChar, district)
                .query(`
                    INSERT INTO APPROVALS (
                        AuthRef, RequestID, ManagerPersonID, Action, DistrictBranch
                    )
                    OUTPUT INSERTED.ApprovalID
                    VALUES (@authRef, @requestId, @managerId, 'Pending', @district)
                `);
        } else {
            // Legacy non-IDENTITY key: lock the table until the new key is saved.
            const nextIdResult = await new sql.Request(transaction).query(`
                SELECT ISNULL(MAX(ApprovalID), 0) + 1 AS NextId
                FROM APPROVALS WITH (TABLOCKX, HOLDLOCK)
            `);
            const approvalId = nextIdResult.recordset[0].NextId;
            approvalInsert = await new sql.Request(transaction)
                .input('approvalId', sql.Int, approvalId)
                .input('authRef', sql.VarChar, authRef)
                .input('requestId', sql.Int, requestId)
                .input('managerId', sql.Int, managerPersonId)
                .input('district', sql.VarChar, district)
                .query(`
                    INSERT INTO APPROVALS (
                        ApprovalID, AuthRef, RequestID,
                        ManagerPersonID, Action, DistrictBranch
                    )
                    OUTPUT INSERTED.ApprovalID
                    VALUES (
                        @approvalId, @authRef, @requestId,
                        @managerId, 'Pending', @district
                    )
                `);
        }

        const approvalId = approvalInsert.recordset[0].ApprovalID;
        await transaction.commit();
        transactionStarted = false;

        // Notifications and logs are best effort and must not undo a
        // successfully committed placement and approval.
        await logEvent(
            pool, loggedInId,
            `Created placement request #${requestId} and approval #${approvalId} for child #${childId}`,
            req.ip
        );
        await notify(
            pool, candidateFosterParentId, loggedInId,
            'PLACEMENT_REQUEST_CREATED',
            'A Social Worker has submitted a placement request involving your foster parent profile.',
            'PLACEMENT_REQUESTS', requestId
        );
        await notify(
            pool, managerPersonId, loggedInId,
            'PLACEMENT_APPROVAL_PENDING',
            `Placement request #${requestId} needs your approval.`,
            'APPROVALS', approvalId
        );

        return res.status(201).json({
            success: true,
            requestId,
            approvalId,
            authRef,
            message: 'Placement request submitted to the Agency Manager for approval.'
        });

    } catch (err) {
        console.error('Create placement / approval error:', err);
        if (transactionStarted) {
            try {
                await transaction.rollback();
            } catch (rollbackError) {
                console.error('Placement rollback failed:', rollbackError);
            }
        }
        return res.status(500).json({
            error: 'Could not create the placement request and approval together. Check the server log.'
        });
    }
});

/* ==========================================================
   AGENCY MANAGER DASHBOARD
   ========================================================== */

app.get('/api/manager/stats', requireAuth, requireAgencyManager, async (req, res) => {

    try {
        const pool = await getPool();

        const totalActiveCases =
            await pool.request().query(`
                SELECT COUNT(*) AS count
                FROM CHILD
                WHERE CurrentPlacementStatus <> 'Reunified'
            `);

        const pendingApprovals =
            await pool.request()
                .input('managerId', sql.Int, req.session.user.personId)
                .query(`
                    SELECT COUNT(*) AS count
                    FROM APPROVALS
                    WHERE Action = 'Pending'
                      AND ManagerPersonID = @managerId
                `);

        const socialWorkerCount =
            await pool.request().query(`
                SELECT COUNT(*) AS count
                FROM PERSON p
                JOIN ROLES r
                    ON p.RoleID = r.RoleID
                WHERE
                    r.RoleName = 'Social Worker'
                    AND p.Status = 'Active'
            `);

        res.json({

            totalActiveCases:
                totalActiveCases.recordset[0].count,

            pendingApprovals:
                pendingApprovals.recordset[0].count,

            socialWorkerCount:
                socialWorkerCount.recordset[0].count
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.get('/api/manager/social-workers', requireAuth, requireAgencyManager, async (req, res) => {

    try {
        const pool = await getPool();

        const result =
            await pool.request().query(`
                SELECT
                    p.PersonID,
                    p.FullName,
                    p.ProfessionalRegNo,

                    (
                        SELECT COUNT(*)
                        FROM CHILD c
                        WHERE c.CaseWorkerID = p.PersonID
                    ) AS CaseCount

                FROM PERSON p

                JOIN ROLES r
                    ON p.RoleID = r.RoleID

                WHERE r.RoleName = 'Social Worker'

                ORDER BY p.FullName
            `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.get('/api/manager/approvals', requireAuth, requireAgencyManager, async (req, res) => {

    try {
        const pool = await getPool();

        const result =
            await pool.request()
                .input('managerId', sql.Int, req.session.user.personId)
                .query(`
                SELECT
                    ap.ApprovalID,
                    ap.AuthRef,
                    c.FullName AS ChildName,
                    fp.FullName AS FosterParentName,
                    sw.FullName AS SocialWorkerName,
                    fpp.BackgroundCheckStatus

                FROM APPROVALS ap

                JOIN PLACEMENT_REQUESTS pr
                    ON ap.RequestID = pr.RequestID

                JOIN CHILD c
                    ON pr.ChildID = c.ChildID

                JOIN PERSON fp
                    ON pr.CandidateFosterParentID = fp.PersonID

                JOIN PERSON sw
                    ON pr.CaseWorkerID = sw.PersonID

                LEFT JOIN FOSTER_PARENT_PROFILE fpp
                    ON fpp.PersonID = fp.PersonID

                WHERE ap.Action = 'Pending'
                  AND ap.ManagerPersonID = @managerId

                ORDER BY ap.ApprovalID DESC
            `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.put('/api/manager/approvals/:id', requireAuth, requireAgencyManager, async (req, res) => {

    const {
        action,
        managerId
    } = req.body;
    const loggedInId = Number(req.session.user.personId);
const role = req.session.user.role;

if (
    role?.trim().toLowerCase() !== 'agency manager' ||
    !Number.isSafeInteger(loggedInId) ||
    loggedInId <= 0 ||
    Number(managerId) !== loggedInId
) {
    return res.status(403).json({
        error: 'Access denied. Only the logged-in Agency Manager can approve or reject placements.'
    });
}
if (!['Approved', 'Rejected'].includes(action)) {
    return res.status(400).json({
        error: 'Invalid decision. Choose Approved or Rejected.'
    });
}
let transaction;
let transactionStarted = false;


    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);

await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);

transactionStarted = true;
        const existingApproval = await new sql.Request(transaction)
    .input('id', sql.Int, req.params.id)
    .query(`
        SELECT ApprovalID, Action, ManagerPersonID
        FROM APPROVALS WITH (UPDLOCK, HOLDLOCK)
        WHERE ApprovalID = @id
    `);
if (existingApproval.recordset.length === 0) {

    await transaction.rollback();
    transactionStarted = false;

    return res.status(404).json({
        error: 'Approval request not found.'
    });
}


if (Number(existingApproval.recordset[0].ManagerPersonID) !== loggedInId) {
    await transaction.rollback();
    transactionStarted = false;
    return res.status(403).json({
        error: 'This placement approval is assigned to another Agency Manager.'
    });
}

if (existingApproval.recordset[0].Action !== 'Pending') {

    await transaction.rollback();
    transactionStarted = false;

    return res.status(409).json({
        error: 'This approval has already been processed.'
    });
}

      const updateResult = await new sql.Request(transaction)
            .input(
                'id',
                sql.Int,
                req.params.id
            )
            .input(
                'action',
                sql.VarChar,
                action
            )
            .input(
                'managerId',
                sql.Int,
                managerId
            )
            .query(`
              UPDATE APPROVALS
SET
    Action = @action,
    ManagerPersonID = @managerId,
    DecisionDate = SYSDATETIME()
WHERE ApprovalID = @id
  AND Action = 'Pending'
  AND ManagerPersonID = @managerId
            `);
           if (updateResult.rowsAffected[0] !== 1) {

    await transaction.rollback();
    transactionStarted = false;

    return res.status(409).json({
        error: 'Approval was not updated. It may have already been processed.'
    });
}


        const info =
    await new sql.Request(transaction)
                .input(
                    'id',
                    sql.Int,
                    req.params.id
                )
                .query(`
                    SELECT
                        pr.RequestID,
                        pr.ChildID,
                        pr.CandidateFosterParentID,
                        pr.CaseWorkerID

                    FROM APPROVALS ap

                    JOIN PLACEMENT_REQUESTS pr
                        ON ap.RequestID = pr.RequestID

                    WHERE ap.ApprovalID = @id
                `);
                if (info.recordset.length === 0) {

    await transaction.rollback();
    transactionStarted = false;

    return res.status(409).json({
        error: 'The linked placement request could not be found.'
    });
}


       

            const {
                RequestID,
                ChildID,
                CandidateFosterParentID,
                CaseWorkerID
            } = info.recordset[0];
            const placementCheck = await new sql.Request(transaction)
    .input('requestId', sql.Int, RequestID)
    .query(`
        SELECT Status
        FROM PLACEMENT_REQUESTS WITH (UPDLOCK, HOLDLOCK)
        WHERE RequestID = @requestId
    `);

if (
    placementCheck.recordset.length !== 1 ||
    placementCheck.recordset[0].Status !== 'Pending'
) {
    await transaction.rollback();
    transactionStarted = false;

    return res.status(409).json({
        error: 'Only pending placement requests can be processed.'
    });
}


            const finalStatus =
                action === 'Approved'
                    ? 'Approved'
                    : 'Rejected';


            await new sql.Request(transaction)
                .input(
                    'id',
                    sql.Int,
                    RequestID
                )
                .input(
                    'status',
                    sql.VarChar,
                    finalStatus
                )
                .query(`
                    UPDATE PLACEMENT_REQUESTS
                    SET Status = @status
                    WHERE RequestID = @id
                `);
                if (action === 'Approved') {

    const childCheck = await new sql.Request(transaction)
        .input('childId', sql.Int, ChildID)
        .query(`
            SELECT CurrentPlacementStatus
            FROM CHILD WITH (UPDLOCK, HOLDLOCK)
            WHERE ChildID = @childId
        `);

    if (
        childCheck.recordset.length !== 1 ||
        childCheck.recordset[0].CurrentPlacementStatus !== 'Unplaced'
    ) {
        await transaction.rollback();
        transactionStarted = false;

        return res.status(409).json({
            error: 'The child must be unplaced before approval.'
        });
    }
}
if (action === 'Approved') {

    if (!(await sameProvincePlacement(transaction, ChildID, CandidateFosterParentID))) {
        await transaction.rollback();
        transactionStarted = false;
        return res.status(403).json({ error: 'Placement cannot be approved across different provinces.' });
    }

    const fosterCheck = await new sql.Request(transaction)
        .input('fosterParentId', sql.Int, CandidateFosterParentID)
        .query(`
            SELECT
                p.PersonID,
                p.Status,
                fp.BackgroundCheckStatus,
                fp.HomeEvaluationScore
            FROM PERSON p WITH (UPDLOCK, HOLDLOCK)
            JOIN ROLES r ON p.RoleID = r.RoleID
            JOIN FOSTER_PARENT_PROFILE fp
                ON fp.PersonID = p.PersonID
            WHERE p.PersonID = @fosterParentId
              AND r.RoleName = 'Foster Parent'
        `);

    if (
        fosterCheck.recordset.length !== 1 ||
        fosterCheck.recordset[0].Status !== 'Active' ||
        fosterCheck.recordset[0].BackgroundCheckStatus !== 'Passed' ||
        fosterCheck.recordset[0].HomeEvaluationScore == null
    ) {
        await transaction.rollback();
        transactionStarted = false;

        return res.status(403).json({
            error: 'Foster parent eligibility requirements are not met.'
        });
    }

    const applicationCheck = await new sql.Request(transaction)
        .input('fosterParentId', sql.Int, CandidateFosterParentID)
        .query(`
            SELECT TOP 1 AppID
            FROM APPLICATIONS WITH (UPDLOCK, HOLDLOCK)
            WHERE ApplicantPersonID = @fosterParentId
              AND Status = 'Approved'
        `);

    if (applicationCheck.recordset.length === 0) {
        await transaction.rollback();
        transactionStarted = false;

        return res.status(403).json({
            error: 'Foster parent must have an approved application.'
        });
    }
}
if (action === 'Approved') {

    const conflictCheck = await new sql.Request(transaction)
        .input('childId', sql.Int, ChildID)
        .input('requestId', sql.Int, RequestID)
        .query(`
            SELECT RequestID
            FROM PLACEMENT_REQUESTS WITH (UPDLOCK, HOLDLOCK)
            WHERE ChildID = @childId
              AND RequestID <> @requestId
              AND Status = 'Approved'
        `);

    if (conflictCheck.recordset.length > 0) {

        await transaction.rollback();
        transactionStarted = false;

        return res.status(409).json({
            error: 'Another placement has already been approved for this child.'
        });
    }
}


          const childStatus = 'Placed';

            if (action === 'Approved') {

    await new sql.Request(transaction)
        .input('childId', sql.Int, ChildID)
        .input('status', sql.VarChar, childStatus)
        .query(`
            UPDATE CHILD
            SET CurrentPlacementStatus = @status
            WHERE ChildID = @childId
          `);



          
}

// Notify the biological parent only when the foster-care placement is approved.
// Save the notification in the same transaction as the approval so neither
// can be committed without the other.
if (action === 'Approved') {
    const parentDetails = await new sql.Request(transaction)
        .input('childId', sql.Int, ChildID)
        .input('fosterParentId', sql.Int, CandidateFosterParentID)
        .query(`
            SELECT c.FullName AS ChildName,
                   c.BiologicalParentID,
                   fp.FullName AS FosterParentName
            FROM CHILD c
            JOIN PERSON fp ON fp.PersonID = @fosterParentId
            WHERE c.ChildID = @childId
        `);

    const placement = parentDetails.recordset[0];
    if (!placement) {
        throw new Error('Child or foster parent missing during placement approval.');
    }

    if (placement.BiologicalParentID) {
        const message = `The foster-care placement of your child ${placement.ChildName} with ${placement.FosterParentName} has been approved by the Agency Manager. Contact your Social Worker for details.`;

        await new sql.Request(transaction)
            .input('recipientId', sql.Int, placement.BiologicalParentID)
            .input('senderId', sql.Int, loggedInId)
            .input('message', sql.VarChar(sql.MAX), message)
            .input('approvalId', sql.Int, Number(req.params.id))
            .query(`
                INSERT INTO NOTIFICATIONS
                    (RecipientID, SenderID, EventType, Message, RelatedTable, RelatedID)
                VALUES
                    (@recipientId, @senderId, 'PLACEMENT_APPROVED_PARENT',
                     @message, 'APPROVALS', @approvalId)
            `);
    } else {
        console.warn(`Child #${ChildID} has no BiologicalParentID; parent notification skipped.`);
    }

    // Record the foster parent's approval notification in the same transaction.
    // The placement approval must not succeed without its recipient notification.
    const fosterMessage = `The Agency Manager has approved the foster-care placement of ${placement.ChildName} with you. This confirms an approved foster-care placement, not a legal adoption.`;
    await new sql.Request(transaction)
        .input('recipientId', sql.Int, CandidateFosterParentID)
        .input('senderId', sql.Int, loggedInId)
        .input('message', sql.VarChar(sql.MAX), fosterMessage)
        .input('approvalId', sql.Int, Number(req.params.id))
        .query(`
            INSERT INTO NOTIFICATIONS
                (RecipientID, SenderID, EventType, Message, RelatedTable, RelatedID)
            VALUES
                (@recipientId, @senderId, 'PLACEMENT_APPROVED_FOSTER',
                 @message, 'APPROVALS', @approvalId)
        `);
}

await transaction.commit();
transactionStarted = false;

if (action === 'Rejected') {
    await notify(
        pool,
        CandidateFosterParentID,
        managerId,
        'MANAGER_REJECTED',
        'Agency management has rejected the proposed foster-care placement.',
        'APPROVALS',
        req.params.id
    );
}
await notify(
    pool,
    CaseWorkerID,
    managerId,
    'MANAGER_' + action.toUpperCase(),
    `Your recommended placement has received a final ${action.toLowerCase()} decision from management.`,
    'APPROVALS',
    req.params.id
);


        await logEvent(
            pool,
            managerId,
            `Set approval #${req.params.id} to ${action}`,
            req.ip
        );


        res.json({
            success: true
        });
    
    } catch (err) {

    console.error('Agency Manager approval error:', err);

    if (transactionStarted) {
        try {
            await transaction.rollback();
            transactionStarted = false;
        } catch (rollbackError) {
            console.error('Rollback failed:', rollbackError);
        }
    }

    return res.status(500).json({
        error: 'Unable to process the approval.'
    });
}


});
app.get('/api/manager/partners', requireAuth, requireAgencyManager, async (req, res) => {

    try {
        const pool = await getPool();

        const result =
            await pool.request().query(`
                SELECT *
                FROM REGIONAL_PARTNERS
                ORDER BY OrgName
            `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.post('/api/manager/partners', requireAuth, requireAgencyManager, async (req, res) => {

    const {
        orgName,
        contactPerson,
        district
    } = req.body;


    if (!orgName) {

        return res.status(400).json({
            error: 'Organization name is required.'
        });
    }


    try {
        const pool = await getPool();

        await pool.request()

            .input(
                'orgName',
                sql.VarChar,
                orgName
            )

            .input(
                'contactPerson',
                sql.VarChar,
                contactPerson || null
            )

            .input(
                'district',
                sql.VarChar,
                district || null
            )

            .query(`
                INSERT INTO REGIONAL_PARTNERS (
                    OrgName,
                    ContactPerson,
                    District
                )

                VALUES (
                    @orgName,
                    @contactPerson,
                    @district
                )
            `);


        res.json({
            success: true
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


/* ==========================================================
   BIOLOGICAL PARENT DASHBOARD
   ========================================================== */

app.get(
    '/api/bioparent/overview/:personId',
    requireAuth,
    requireBiologicalParent,
    requireOwnParentAccount,
    async (req, res) => {

    try {
        const pool = await getPool();

        const id =
            req.params.personId;


        const activeCases =
            await pool.request()
                .input(
                    'id',
                    sql.Int,
                    id
                )
                .query(`
                    SELECT COUNT(*) AS count
                    FROM CHILD
                    WHERE BiologicalParentID = @id
                `);



        // The dashboard contact follows the parent's CURRENT saved district,
        // not the caseworker attached to an existing child record.
        const worker = await districtContact(pool, Number(id));
        res.json({
            activeCases: activeCases.recordset[0].count,
            caseWorkerName: worker ? worker.FullName : 'No Social Worker assigned to your district'
        });
    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});
        // ===========================================
// BIOLOGICAL PARENT - REGISTER CHILD
// ===========================================

app.post(
    '/api/bioparent/children',
    requireAuth,
    requireBiologicalParent,
    async (req, res) => {
        const { fullName, dateOfBirth, gender } = req.body;
        const parentId = Number(req.session.user.personId);

        if (
            typeof fullName !== 'string' || !fullName.trim() ||
            fullName.trim().length > 200 ||
            typeof dateOfBirth !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) ||
            typeof gender !== 'string' ||
            !['Male', 'Female', 'Other'].includes(gender)
        ) {
            return res.status(400).json({ error: 'Please enter valid child information.' });
        }

        const dob = new Date(`${dateOfBirth}T00:00:00Z`);
        if (Number.isNaN(dob.getTime()) ||
            dob.toISOString().slice(0, 10) !== dateOfBirth ||
            dob > new Date()) {
            return res.status(400).json({ error: 'Please enter a valid date of birth.' });
        }

        let transaction;
        let transactionStarted = false;
        try {
            const pool = await getPool();
            transaction = new sql.Transaction(pool);
            await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
            transactionStarted = true;

            // Serialize registrations that use this same assignment mechanism.
            const lockResult = await new sql.Request(transaction).query(`
                DECLARE @lockCode INT;
                EXEC @lockCode = sys.sp_getapplock
                    @Resource = 'FosterCare_ChildAssignment',
                    @LockMode = 'Exclusive',
                    @LockOwner = 'Transaction',
                    @LockTimeout = 10000;
                SELECT @lockCode AS LockResult;
            `);
            if (lockResult.recordset[0].LockResult < 0) {
                throw new Error('Could not obtain assignment lock.');
            }

            const parentResult = await new sql.Request(transaction)
                .input('parentId', sql.Int, parentId)
                .query(`
                    SELECT RegionDistrict FROM dbo.PERSON
                    WHERE PersonID = @parentId AND RoleID = 4 AND Status = 'Active'
                `);
            if (!parentResult.recordset.length) {
                await transaction.rollback();
                transactionStarted = false;
                return res.status(403).json({ error: 'Active Biological Parent account not found.' });
            }

            const savedLocation = (parentResult.recordset[0].RegionDistrict || '').trim();
            if (!savedLocation) {
                await transaction.rollback();
                transactionStarted = false;
                return res.status(400).json({
                    error: 'Please open My Profile and save your province, district and city first.'
                });
            }

            // New profile format is "District|Town". Older profiles may contain
            // only "East London" or "Mthatha"; continue supporting those.
            const savedParts = savedLocation.split('|').map(value => value.trim());
            if (savedParts.length !== 3 || savedParts.some(value => !value)) {
                await transaction.rollback();
                transactionStarted = false;
                return res.status(400).json({
                    error: 'Your profile location is invalid. Please save it again in My Profile.'
                });
            }
            const districtPrefix = savedParts[0] + ' | ' + savedParts[1];
            // Match province AND district; select the smallest active child caseload.
            const workerResult = await new sql.Request(transaction)
                .input('districtPrefix', sql.VarChar(220), districtPrefix)
                .query(`
                    SELECT TOP 1 sw.PersonID, sw.FullName, COUNT(c.ChildID) AS AssignedCases
                    FROM PERSON sw
                    JOIN ROLES r ON r.RoleID = sw.RoleID
                    LEFT JOIN CHILD c ON c.CaseWorkerID = sw.PersonID
                    WHERE r.RoleName = 'Social Worker' AND sw.Status = 'Active'
                      AND sw.RegionDistrict LIKE @districtPrefix + ' | %'
                    GROUP BY sw.PersonID, sw.FullName
                    ORDER BY COUNT(c.ChildID), sw.PersonID
                `);
            const assignedWorker = workerResult.recordset[0] || null;

            const result = await new sql.Request(transaction)
                .input('fullName', sql.VarChar(200), fullName.trim())
                .input('dob', sql.Date, dateOfBirth)
                .input('gender', sql.VarChar(20), gender)
                .input('parentId', sql.Int, parentId)
                .input('caseWorkerId', sql.Int, assignedWorker?.PersonID ?? null)
                .query(`
                    INSERT INTO dbo.CHILD
                        (FullName, DateOfBirth, Gender, BiologicalParentID,
                         CaseWorkerID, CurrentPlacementStatus)
                    OUTPUT INSERTED.ChildID
                    VALUES (@fullName, @dob, @gender, @parentId,
                            @caseWorkerId, 'Unplaced')
                `);
            const childId = result.recordset[0].ChildID;
            await transaction.commit();
            transactionStarted = false;

            await logEvent(pool, parentId, 'Registered child record ID: ' + childId, req.ip);
            if (assignedWorker) {
                await notify(pool, assignedWorker.PersonID, parentId,
                    'CHILD_ASSIGNED', 'A new child case has been assigned to you.',
                    'CHILD', childId);
            } else {
                // No matching worker: flag this record for administrative review.
                const admins = await pool.request().query(`
                    SELECT PersonID FROM dbo.PERSON
                    WHERE RoleID = 1 AND Status = 'Active'
                `);
                for (const admin of admins.recordset) {
                    await notify(pool, admin.PersonID, parentId,
                        'CHILD_ASSIGNMENT_REVIEW',
                        'A child registration needs manual Social Worker assignment.',
                        'CHILD', childId);
                }
            }
            return res.status(201).json({
                success: true, childId,
                message: assignedWorker ? 'Child registered and Social Worker assigned.' :
                    'Child registered for manual assignment review.',
                socialWorkerAssigned: assignedWorker !== null
            });
        } catch (err) {
            console.error('Child registration error:', err);
            if (transactionStarted) {
                try { await transaction.rollback(); }
                catch (rollbackError) {
                    console.error('Transaction rollback error:', rollbackError.message);
                }
            }
            return res.status(500).json({ error: 'Unable to register child.' });
        }
    }
);

app.get(
    '/api/bioparent/children/:personId',
    requireAuth,
    requireBiologicalParent,
    requireOwnParentAccount,
    async (req, res) => {


    try {
        const pool = await getPool();
        const result =
            await pool.request()
                .input(
                    'id',
                    sql.Int,
                    req.params.personId
                )
                .query(`
                    SELECT
                        c.ChildID,
                        c.FullName,
                        c.DateOfBirth,
                        c.CurrentPlacementStatus,
                        sw.FullName AS CaseWorkerName

                    FROM CHILD c

                    LEFT JOIN PERSON sw
                        ON c.CaseWorkerID = sw.PersonID

                    WHERE c.BiologicalParentID = @id
                `);


        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.get('/api/fosterparent/visitations/:personId', requireAuth, async (req, res) => {
    const personId = Number(req.params.personId);
    if (String(req.session.user.role || '').trim().toLowerCase() !== 'foster parent' ||
        Number(req.session.user.personId) !== personId)
        return res.status(403).json({error:'Foster Parent account required.'});
    try {
        const pool = await getPool();
        const result = await pool.request().input('id', sql.Int, personId).query(`
            SELECT v.ScheduleID, c.FullName AS ChildName, v.EventType,
                   v.EventDateTime, v.Location, v.Status
            FROM VISITATION_SCHEDULE v
            JOIN CHILD c ON c.ChildID = v.ChildID
            WHERE EXISTS (
                SELECT 1 FROM PLACEMENT_REQUESTS pr
                WHERE pr.ChildID = v.ChildID AND pr.CandidateFosterParentID = @id
                  AND pr.Status = 'Approved'
            )
            ORDER BY v.EventDateTime DESC
        `);
        return res.json(result.recordset);
    } catch (err) {
        console.error('Foster parent visitations:',err);
        return res.status(500).json({error:'Could not load visitations.'});
    }
});

app.get('/api/bioparent/schedule/:personId', requireAuth, requireBiologicalParent, requireOwnParentAccount, async (req, res) => {

    try {
        const pool = await getPool();

        const result =
            await pool.request()
                .input(
                    'id',
                    sql.Int,
                    req.params.personId
                )
                .query(`
                    SELECT v.ScheduleID, c.FullName AS ChildName,
                           v.EventType, v.EventDateTime, v.Location, v.Status
                    FROM VISITATION_SCHEDULE v
                    JOIN CHILD c ON c.ChildID = v.ChildID
                    WHERE v.BiologicalParentID = @id

                    ORDER BY EventDateTime
                `);


        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.get('/api/bioparent/worker/:personId', requireAuth, requireBiologicalParent,
    requireOwnParentAccount, async (req, res) => {
    try {
        const pool = await getPool();
        res.json(await districtContact(pool, Number(req.params.personId)));
    } catch (err) {
        console.error('Biological parent district contact:', err);
        res.status(500).json({ error: 'Could not load district social worker.' });
    }
});

app.get(
    '/api/bioparent/documents/:personId',
    requireAuth,
    requireBiologicalParent,
    requireOwnParentAccount,
    async (req, res) => {

    try {
        const pool = await getPool();

        const result =
            await pool.request()
                .input(
                    'id',
                    sql.Int,
                    req.params.personId
                )
                .query(`
                    SELECT
                        DocumentID,
                        DocumentType,
                        FileName,
                        UploadDate,
                        Status

                    FROM DOCUMENTS

                    WHERE UploadedByID = @id

                    ORDER BY UploadDate DESC
                `);


        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.post(
    '/api/bioparent/documents',
    requireAuth,
    requireBiologicalParent,
    upload.single('file'),
    async (req, res) => {

      const { documentType } = req.body;

const uploadedById = req.session.user.personId;

        if (!req.file) {

            return res.status(400).json({
                error: 'No file was received.'
            });
        }


        try {
            const pool = await getPool();


            await pool.request()

                .input(
                    'uploadedBy',
                    sql.Int,
                    uploadedById
                )

                .input(
                    'docType',
                    sql.VarChar,
                    documentType
                )

                .input(
                    'fileName',
                    sql.VarChar,
                    req.file.originalname
                )

                .input(
                    'filePath',
                    sql.VarChar,
                    '/uploads/' + req.file.filename
                )

                .query(`
                    INSERT INTO DOCUMENTS (
                        UploadedByID,
                        DocumentType,
                        FileName,
                        FilePath
                    )

                    VALUES (
                        @uploadedBy,
                        @docType,
                        @fileName,
                        @filePath
                    )
                `);


            const worker =
                await pool.request()
                    .input(
                        'id',
                        sql.Int,
                        uploadedById
                    )
                    .query(`
                        SELECT TOP 1
                            c.CaseWorkerID

                        FROM CHILD c

                        WHERE
                            c.BiologicalParentID = @id
                            AND c.CaseWorkerID IS NOT NULL
                    `);


            if (worker.recordset.length > 0) {

                await notify(
                    pool,
                    worker.recordset[0].CaseWorkerID,
                    uploadedById,
                    'DOCUMENT_UPLOADED',
                    `A biological parent has submitted a new document (${documentType}) for your review.`,
                    'DOCUMENTS',
                    null
                );
            }


            await logEvent(
                pool,
                uploadedById,
                `Uploaded document: ${documentType}`,
                req.ip
            );


            res.json({
                success: true
            });

        } catch (err) {
            console.error(err);

            res.status(500).json({
                error: err.message
            });
        }
    }
);


/* Biological parent document management */
const documentUpload = multer({
    dest: uploadsDir,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
        if (!allowed.includes(file.mimetype)) return cb(new Error('Only PDF, JPG and PNG files are allowed.'));
        cb(null, true);
    }
});
function validDocumentId(req, res, next) {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid document ID.' });
    req.documentId = id;
    next();
}
async function ownedDocument(pool, documentId, parentId) {
    const result = await pool.request()
        .input('id', sql.Int, documentId)
        .input('parentId', sql.Int, parentId)
        .query('SELECT DocumentID, DocumentType, FileName, FilePath, Status FROM DOCUMENTS WHERE DocumentID = @id AND UploadedByID = @parentId');
    return result.recordset[0];
}
function localDocumentPath(filePath) {
    const filename = path.basename(String(filePath || ''));
    if (!/^[a-f0-9]{32}$/i.test(filename)) return null;
    return path.join(uploadsDir, filename);
}
app.get('/api/bioparent/documents/file/:id', requireAuth, requireBiologicalParent, validDocumentId, async (req, res) => {
    try {
        const pool = await getPool();
        const doc = await ownedDocument(pool, req.documentId, Number(req.session.user.personId));
        if (!doc) return res.status(404).json({ error: 'Document not found.' });
        const file = localDocumentPath(doc.FilePath);
        if (!file) return res.status(404).json({ error: 'Document file is unavailable.' });
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        res.setHeader('Content-Disposition', 'attachment; filename="document"');
        return res.download(file, path.basename(doc.FileName || 'document'), err => {
            if (err && !res.headersSent) res.status(404).json({ error: 'Document file is unavailable.' });
        });
    } catch (err) {
        console.error('Download document:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Could not retrieve document.' });
    }
});
app.put('/api/bioparent/documents/:id', requireAuth, requireBiologicalParent, validDocumentId,
    (req, res, next) => documentUpload.single('file')(req, res, err => {
        if (err) return res.status(400).json({ error: err.message });
        next();
    }), async (req, res) => {
        const cleanup = () => { if (req.file) fs.promises.unlink(req.file.path).catch(() => {}); };
        if (!req.file) return res.status(400).json({ error: 'Select a replacement file.' });
        try {
            const pool = await getPool();
            const parentId = Number(req.session.user.personId);
            const doc = await ownedDocument(pool, req.documentId, parentId);
            if (!doc) { cleanup(); return res.status(404).json({ error: 'Document not found.' }); }
            if (String(doc.Status || '').toLowerCase() === 'approved') {
                cleanup(); return res.status(409).json({ error: 'Approved documents cannot be replaced. Contact your social worker.' });
            }
            const type = typeof req.body.documentType === 'string' && req.body.documentType.trim()
                ? req.body.documentType.trim() : doc.DocumentType;
            if (type.length > 100) { cleanup(); return res.status(400).json({ error: 'Document type is too long.' }); }
            const updated = await pool.request()
                .input('id', sql.Int, req.documentId).input('parentId', sql.Int, parentId)
                .input('type', sql.VarChar(100), type)
                .input('name', sql.VarChar(255), req.file.originalname.slice(0, 255))
                .input('filePath', sql.VarChar(500), '/uploads/' + req.file.filename)
                .query(`UPDATE DOCUMENTS SET DocumentType=@type, FileName=@name, FilePath=@filePath, Status='Pending'
                        WHERE DocumentID=@id AND UploadedByID=@parentId AND (Status IS NULL OR Status <> 'Approved')`);
            if (updated.rowsAffected[0] !== 1) { cleanup(); return res.status(409).json({ error: 'Document could not be replaced.' }); }
            const oldPath = localDocumentPath(doc.FilePath);
            if (oldPath) fs.promises.unlink(oldPath).catch(() => {});
            await logEvent(pool, parentId, `Replaced document #${req.documentId}`, req.ip);
            return res.json({ success: true, message: 'Document replaced and sent for review.' });
        } catch (err) {
            cleanup(); console.error('Replace document:', err);
            return res.status(500).json({ error: 'Could not replace document.' });
        }
    });
app.delete('/api/bioparent/documents/:id', requireAuth, requireBiologicalParent, validDocumentId, async (req, res) => {
    try {
        const pool = await getPool();
        const parentId = Number(req.session.user.personId);
        const doc = await ownedDocument(pool, req.documentId, parentId);
        if (!doc) return res.status(404).json({ error: 'Document not found.' });
        if (String(doc.Status || '').toLowerCase() === 'approved')
            return res.status(409).json({ error: 'Approved documents cannot be withdrawn. Contact your social worker.' });
        const result = await pool.request().input('id', sql.Int, req.documentId).input('parentId', sql.Int, parentId)
            .query("DELETE FROM DOCUMENTS WHERE DocumentID=@id AND UploadedByID=@parentId AND (Status IS NULL OR Status <> 'Approved')");
        if (result.rowsAffected[0] !== 1) return res.status(409).json({ error: 'Document could not be withdrawn.' });
        const oldPath = localDocumentPath(doc.FilePath);
        if (oldPath) fs.promises.unlink(oldPath).catch(() => {});
        await logEvent(pool, parentId, `Withdrew document #${req.documentId}`, req.ip);
        return res.json({ success: true });
    } catch (err) {
        console.error('Withdraw document:', err);
        return res.status(500).json({ error: 'Could not withdraw document.' });
    }
});

app.get('/uploads/:filename', requireAuth, requireSocialWorker, async (req, res) => {
    const filename = req.params.filename;
    if (!/^[a-f0-9]{32}$/i.test(filename)) return res.status(404).end();
    try {
        const pool = await getPool();
        const result = await pool.request().input('filePath', sql.VarChar(500), '/uploads/' + filename)
            .input('worker', sql.Int, Number(req.session.user.personId))
            .query(`SELECT TOP 1 d.FileName FROM DOCUMENTS d
                    JOIN CHILD c ON c.BiologicalParentID=d.UploadedByID
                    WHERE d.FilePath=@filePath AND c.CaseWorkerID=@worker`);
        if (!result.recordset.length) return res.status(404).end();
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.download(path.join(uploadsDir, filename), path.basename(result.recordset[0].FileName || 'document'));
    } catch (err) {
        console.error('Worker document download:', err);
        if (!res.headersSent) return res.status(500).end();
    }
});


app.get('/api/manager/biological-documents', requireAuth, requireAgencyManager, async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT d.DocumentID, d.DocumentType, d.FileName, d.UploadDate,
                   d.Status, p.FullName AS SubmittedBy
            FROM DOCUMENTS d
            JOIN PERSON p ON p.PersonID = d.UploadedByID
            JOIN ROLES r ON r.RoleID = p.RoleID
            WHERE r.RoleName = 'Biological Parent'
            ORDER BY d.UploadDate DESC, d.DocumentID DESC
        `);
        return res.json(result.recordset);
    } catch (err) {
        console.error('Agency Manager documents:', err);
        return res.status(500).json({error:'Could not load biological parent documents.'});
    }
});

app.put('/api/manager/biological-documents/:id/status', requireAuth, requireAgencyManager, validDocumentId, async (req, res) => {
    if (req.body?.status !== 'Approved') {
        return res.status(400).json({ error: 'Only document approval is supported here.' });
    }
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, req.documentId)
            .query(`UPDATE d SET d.Status = 'Approved'
                    OUTPUT INSERTED.DocumentID, INSERTED.Status, INSERTED.UploadedByID
                    FROM DOCUMENTS d
                    JOIN PERSON p ON p.PersonID = d.UploadedByID
                    JOIN ROLES r ON r.RoleID = p.RoleID
                    WHERE d.DocumentID = @id
                      AND r.RoleName = 'Biological Parent'
                      AND (d.Status IS NULL OR d.Status IN ('Submitted', 'Pending'))`);
        if (!result.recordset.length) {
            return res.status(409).json({ error: 'Document not found or no longer awaiting approval. Refresh the list.' });
        }
        const document = result.recordset[0];
        await logEvent(pool, Number(req.session.user.personId),
            `Approved biological parent document #${req.documentId}`, req.ip);
        await notify(pool, document.UploadedByID, Number(req.session.user.personId),
            'DOCUMENT_APPROVED', 'Your submitted document has been approved.',
            'DOCUMENTS', req.documentId);
        return res.json({ success: true, status: document.Status });
    } catch (err) {
        console.error('Agency Manager document approval:', err);
        return res.status(500).json({ error: 'Could not approve document.' });
    }
});

app.get('/api/manager/biological-documents/:id/file', requireAuth, requireAgencyManager, validDocumentId, async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().input('id', sql.Int, req.documentId).query(`
            SELECT d.FileName, d.FilePath
            FROM DOCUMENTS d
            JOIN PERSON p ON p.PersonID = d.UploadedByID
            JOIN ROLES r ON r.RoleID = p.RoleID
            WHERE d.DocumentID = @id AND r.RoleName = 'Biological Parent'
        `);
        const doc = result.recordset[0];
        if (!doc) return res.status(404).json({error:'Document not found.'});
        const file = localDocumentPath(doc.FilePath);
        if (!file) return res.status(404).json({error:'Document file unavailable.'});
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        return res.download(file, path.basename(doc.FileName || 'document'), err => {
            if (err && !res.headersSent) res.status(404).json({error:'Document unavailable.'});
        });
    } catch (err) {
        console.error('Agency Manager document download:',err);
        if (!res.headersSent) return res.status(500).json({error:'Could not retrieve document.'});
    }
});

/* ==========================================================
   CLERK DASHBOARD
   ========================================================== */

app.get('/api/clerk/stats', async (req, res) => {

    try {
        const pool = await getPool();


        const pending =
            await pool.request().query(`
                SELECT COUNT(*) AS count
                FROM CASE_INTAKE
                WHERE Status = 'In Queue'
            `);


        const processed =
            await pool.request().query(`
                SELECT COUNT(*) AS count
                FROM CASE_INTAKE
                WHERE Status = 'Processed'
            `);


        const total =
            await pool.request().query(`
                SELECT COUNT(*) AS count
                FROM CASE_INTAKE
            `);


        res.json({

            pendingChecks:
                pending.recordset[0].count,

            processed:
                processed.recordset[0].count,

            totalRecords:
                total.recordset[0].count
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.post('/api/clerk/intake', async (req, res) => {

    const {
        applicantFullName,
        applicantSAID,
        childFullName,
        magisterialDistrict,
        clerkId
    } = req.body;


    if (
        !applicantFullName ||
        !applicantSAID ||
        !childFullName ||
        !magisterialDistrict
    ) {

        return res.status(400).json({
            error: 'All fields are required.'
        });
    }


    try {
        const pool = await getPool();


        const insertResult =
            await pool.request()

                .input(
                    'refId',
                    sql.VarChar,
                    'TEMP'
                )

                .input(
                    'applicantFullName',
                    sql.VarChar,
                    applicantFullName
                )

                .input(
                    'applicantSAID',
                    sql.VarChar,
                    applicantSAID
                )

                .input(
                    'childFullName',
                    sql.VarChar,
                    childFullName
                )

                .input(
                    'district',
                    sql.VarChar,
                    magisterialDistrict
                )

                .input(
                    'clerkId',
                    sql.Int,
                    clerkId
                )

                .query(`
                    INSERT INTO CASE_INTAKE (
                        RefID,
                        ApplicantFullName,
                        ApplicantSAIDNumber,
                        ChildFullName,
                        MagisterialDistrict,
                        SubmittedByClerkID
                    )

                    OUTPUT INSERTED.IntakeID

                    VALUES (
                        @refId,
                        @applicantFullName,
                        @applicantSAID,
                        @childFullName,
                        @district,
                        @clerkId
                    )
                `);


        const newId =
            insertResult.recordset[0].IntakeID;


        await pool.request()

            .input(
                'id',
                sql.Int,
                newId
            )

            .input(
                'refId',
                sql.VarChar,
                'APP-' + (300 + newId)
            )

            .query(`
                UPDATE CASE_INTAKE
                SET RefID = @refId
                WHERE IntakeID = @id
            `);


        await logEvent(
            pool,
            clerkId,
            `Registered new intake for ${applicantFullName}`,
            req.ip
        );


        res.json({
            success: true
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.get('/api/clerk/queue', async (req, res) => {

    try {
        const pool = await getPool();

        const result =
            await pool.request().query(`
                SELECT
                    IntakeID,
                    RefID,
                    ApplicantFullName,
                    ChildFullName,
                    MagisterialDistrict,
                    Status

                FROM CASE_INTAKE

                WHERE Status IN (
                    'In Queue',
                    'Processed'
                )

                ORDER BY SubmissionDate
            `);


        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.put('/api/clerk/queue/:id/process', async (req, res) => {

    const {
        clerkId
    } = req.body;


    try {
        const pool = await getPool();


        await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.id
            )
            .query(`
                UPDATE CASE_INTAKE
                SET Status = 'Processed'
                WHERE IntakeID = @id
            `);


        await logEvent(
            pool,
            clerkId,
            `Verified and processed intake #${req.params.id}`,
            req.ip
        );


        res.json({
            success: true
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});
/* ==========================================================
   SOCIAL WORKER: schedule hearings / visits for a biological
   parent's case
   ========================================================== */

app.get('/api/socialworker/schedule/:personId', requireAuth, requireSocialWorker, async (req, res) => {
    const loggedInId = Number(req.session.user.personId);
    const requestedId = Number(req.params.personId);

    if (!Number.isSafeInteger(loggedInId) || loggedInId <= 0 ||
        !Number.isSafeInteger(requestedId) || requestedId !== loggedInId) {
        return res.status(403).json({ error: 'You can only view your own scheduled events.' });
    }

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, loggedInId)
            .query(`
                SELECT
                    v.ScheduleID,
                    c.FullName AS ChildName,
                    bp.FullName AS ParentName,
                    v.EventType,
                    v.EventDateTime,
                    v.Location,
                    v.Status
                FROM VISITATION_SCHEDULE v
                JOIN CHILD c ON v.ChildID = c.ChildID
                JOIN PERSON bp ON v.BiologicalParentID = bp.PersonID
                WHERE v.CaseWorkerID = @id
                  AND c.CaseWorkerID = @id
                ORDER BY v.EventDateTime
            `);

        return res.json(result.recordset);
    } catch (err) {
        console.error('Load social worker schedule:', err);
        return res.status(500).json({ error: 'Could not load scheduled events.' });
    }
});

app.post('/api/socialworker/schedule', requireAuth, requireSocialWorker, async (req, res) => {

    const {
        childId,
        biologicalParentId,
        eventType,
        eventDateTime,
        location
    } = req.body;

    if (
        !childId ||
        !biologicalParentId ||
        !eventType ||
        !eventDateTime
    ) {
        return res.status(400).json({
            error:
                'Child, biological parent, event type, and date/time are all required.'
        });
    }
    // Resolve the identity from the authenticated server-side session.
    // Older sessions may contain an email but lack a valid personId.
    // Never accept a Social Worker ID supplied by the browser.
    let loggedInId = Number(req.session.user.personId);

    try {
        const pool = await getPool();
        if (!Number.isSafeInteger(loggedInId) || loggedInId <= 0) {
            const sessionEmail = String(req.session.user.email || '').trim().toLowerCase();
            if (!sessionEmail) {
                return res.status(401).json({
                    error: 'Your login session is incomplete. Log out and log in again.'
                });
            }

            const account = await pool.request()
                .input('email', sql.VarChar(254), sessionEmail)
                .query(`SELECT p.PersonID FROM PERSON p
                        JOIN ROLES r ON r.RoleID = p.RoleID
                        WHERE LOWER(p.Email) = @email
                          AND r.RoleName = 'Social Worker'
                          AND p.Status = 'Active'`);
            if (account.recordset.length !== 1) {
                return res.status(403).json({
                    error: 'Your Social Worker account could not be verified. Log in again.'
                });
            }
            loggedInId = Number(account.recordset[0].PersonID);
            req.session.user.personId = loggedInId;
            await new Promise((resolve, reject) =>
                req.session.save(error => error ? reject(error) : resolve()));
        }

        const childCheck = await pool.request()
            .input('childId', sql.Int, Number(childId))
            .input('caseWorkerId', sql.Int, loggedInId)
            .input('parentId', sql.Int, Number(biologicalParentId))
            .query(`
                SELECT ChildID FROM CHILD
                WHERE ChildID = @childId
                  AND CaseWorkerID = @caseWorkerId
                  AND BiologicalParentID = @parentId
            `);

        if (childCheck.recordset.length !== 1) {
            return res.status(403).json({
                error: 'This child is not assigned to you or linked to the selected biological parent.'
            });
        }

        await pool.request()
            .input('childId', sql.Int, childId)
            .input('parentId', sql.Int, biologicalParentId)
            .input('caseWorkerId', sql.Int, loggedInId)
            .input('eventType', sql.VarChar, eventType)
            .input('eventDateTime', sql.DateTime2, eventDateTime)
            .input('location', sql.VarChar, location || null)
            .query(`
                INSERT INTO VISITATION_SCHEDULE (
                    ChildID,
                    BiologicalParentID,
                    CaseWorkerID,
                    EventType,
                    EventDateTime,
                    Location
                )
                VALUES (
                    @childId,
                    @parentId,
                    @caseWorkerId,
                    @eventType,
                    @eventDateTime,
                    @location
                )
            `);

        const placedFoster = await pool.request()
            .input('childId', sql.Int, Number(childId))
            .query(`SELECT TOP 1 p.CandidateFosterParentID AS FosterParentID
                    FROM PLACEMENT_REQUESTS p
                    WHERE p.ChildID = @childId AND p.Status = 'Approved'
                    ORDER BY p.RequestID DESC`);
        if (placedFoster.recordset[0]?.FosterParentID) {
            await notify(pool, placedFoster.recordset[0].FosterParentID,
                loggedInId, 'VISIT_SCHEDULED',
                `A visitation has been scheduled for a child in your care on ${new Date(eventDateTime).toLocaleString('en-ZA')}.`,
                'VISITATION_SCHEDULE', null);
        }

        await notify(
            pool,
            biologicalParentId,
            loggedInId,
            'VISIT_SCHEDULED',
            `A new ${eventType} has been scheduled for your case.`,
            'VISITATION_SCHEDULE',
            null
        );

        await logEvent(
            pool,
            loggedInId,
            `Scheduled ${eventType} for child #${childId}`,
            req.ip
        );

        res.json({
            success: true
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


/* ==========================================================
   ADMIN: view and edit role permission levels
   ========================================================== */

app.get('/api/admin/roles', requireAuth, requireAdmin, async (req, res) => {
    try {
        const pool = await getPool();

    const result = await pool.request()
    .query(`
            SELECT
                RoleID,
                RoleName,
                DashboardAccess,
                DataMutationRights
            FROM ROLES
            ORDER BY RoleID
        `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.put('/api/admin/roles/:id', requireAuth, requireAdmin, async (req, res) => {

    const {
        dataMutationRights,
        actingPersonId
    } = req.body;

    try {
        const pool = await getPool();

        await pool.request()
            .input('id', sql.Int, req.params.id)
            .input(
                'rights',
                sql.VarChar,
                dataMutationRights
            )
            .query(`
                UPDATE ROLES
                SET DataMutationRights = @rights
                WHERE RoleID = @id
            `);

        await logEvent(
            pool,
            actingPersonId,
            `Updated permissions for role #${req.params.id} to ${dataMutationRights}`,
            req.ip
        );

        res.json({
            success: true
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


/* ==========================================================
   CLERK ARCHIVE
   ========================================================== */

app.get('/api/clerk/archive', async (req, res) => {
    try {
        const pool = await getPool();

        const result = await pool.request()
            .query(`
                SELECT
                    ArchiveID,
                    CaseName,
                    District,
                    ArchivalDate,
                    Status
                FROM CASE_ARCHIVE
                ORDER BY ArchivalDate DESC
            `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.post('/api/clerk/archive/:intakeId', async (req, res) => {

    const {
        clerkId
    } = req.body;

    try {
        const pool = await getPool();

        const info = await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.intakeId
            )
            .query(`
                SELECT
                    ApplicantFullName,
                    MagisterialDistrict
                FROM CASE_INTAKE
                WHERE IntakeID = @id
            `);

        if (info.recordset.length === 0) {
            return res.status(404).json({
                error: 'Case not found.'
            });
        }

        const {
            ApplicantFullName,
            MagisterialDistrict
        } = info.recordset[0];

        await pool.request()
            .input(
                'intakeId',
                sql.Int,
                req.params.intakeId
            )
            .input(
                'caseName',
                sql.VarChar,
                ApplicantFullName + ' File'
            )
            .input(
                'district',
                sql.VarChar,
                MagisterialDistrict
            )
            .query(`
                INSERT INTO CASE_ARCHIVE (
                    IntakeID,
                    CaseName,
                    District
                )
                VALUES (
                    @intakeId,
                    @caseName,
                    @district
                )
            `);

        await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.intakeId
            )
            .query(`
                UPDATE CASE_INTAKE
                SET Status = 'Archived'
                WHERE IntakeID = @id
            `);

        await logEvent(
            pool,
            clerkId,
            `Archived case #${req.params.intakeId}`,
            req.ip
        );

        res.json({
            success: true
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


/* ==========================================================
   FOSTER PARENT DASHBOARD
   ========================================================== */

app.get('/api/fosterparent/overview/:personId', async (req, res) => {
    try {
        const pool = await getPool();

        const id = req.params.personId;

        const placedCount = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT COUNT(*) AS count
                FROM PLACEMENT_REQUESTS
                WHERE
                    CandidateFosterParentID = @id
                    AND Status = 'Approved'
            `);

        const evalScore = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT
                    HomeEvaluationScore,
                    BackgroundCheckStatus
                FROM FOSTER_PARENT_PROFILE
                WHERE PersonID = @id
            `);

        res.json({
            placedChildrenCount:
                placedCount.recordset[0].count,

            homeEvaluationScore:
                evalScore.recordset.length
                    ? evalScore.recordset[0].HomeEvaluationScore
                    : null,

            backgroundCheckStatus:
                evalScore.recordset.length
                    ? evalScore.recordset[0].BackgroundCheckStatus
                    : 'Pending'
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.get('/api/fosterparent/child/:personId', async (req, res) => {
    try {
        const pool = await getPool();

        const result = await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.personId
            )
            .query(`
                SELECT
                    c.ChildID,
                    c.FullName,
                    c.DateOfBirth,
                    c.CurrentPlacementStatus,
                    pr.SubmissionDate AS PlacementDate
                FROM PLACEMENT_REQUESTS pr
                JOIN CHILD c
                    ON pr.ChildID = c.ChildID
                WHERE
                    pr.CandidateFosterParentID = @id
                    AND pr.Status = 'Approved'
            `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.get('/api/fosterparent/stipends/:personId', async (req, res) => {
    try {
        const pool = await getPool();

        const result = await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.personId
            )
            .query(`
                SELECT
                    DisbursementMonth,
                    Amount,
                    ReferenceNumber,
                    Status
                FROM STIPENDS
                WHERE FosterParentID = @id
                ORDER BY StipendID DESC
            `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.get('/api/fosterparent/worker/:personId', requireAuth, async (req, res) => {
    if (String(req.session.user.role || '').trim().toLowerCase() !== 'foster parent' ||
        Number(req.session.user.personId) !== Number(req.params.personId)) {
        return res.status(403).json({ error: 'Foster Parent account required.' });
    }
    try {
        const pool = await getPool();
        res.json(await districtContact(pool, Number(req.params.personId)));
    } catch (err) {
        console.error('Foster parent district contact:', err);
        res.status(500).json({ error: 'Could not load district social worker.' });
    }
});


/* Foster Parent report history and editing: session-scoped. */
app.get('/api/fosterparent/reports', requireAuth, async (req, res) => {
    const role = String(req.session.user.role || '').trim().toLowerCase();
    const parentId = Number(req.session.user.personId);
    if (role !== 'foster parent' || !Number.isSafeInteger(parentId) || parentId <= 0) {
        return res.status(403).json({ error: 'Foster Parent access required.' });
    }
    try {
        const pool = await getPool();
        const result = await pool.request().input('parentId', sql.Int, parentId).query(`
            SELECT r.ReportID, r.ChildID, c.FullName AS ChildName,
                   r.ReportingMonth, r.WellbeingStatus, r.DevelopmentalNotes, r.SubmittedAt
            FROM MONTHLY_REPORTS r
            JOIN CHILD c ON c.ChildID = r.ChildID
            WHERE r.FosterParentID = @parentId
            ORDER BY r.SubmittedAt DESC, r.ReportID DESC
        `);
        return res.json(result.recordset);
    } catch (err) {
        console.error('Foster parent report history:', err);
        return res.status(500).json({ error: 'Could not load report history.' });
    }
});

app.put('/api/fosterparent/reports/:reportId', requireAuth, async (req, res) => {
    const role = String(req.session.user.role || '').trim().toLowerCase();
    const parentId = Number(req.session.user.personId);
    const reportId = Number(req.params.reportId);
    if (role !== 'foster parent' || !Number.isSafeInteger(parentId) || parentId <= 0) {
        return res.status(403).json({ error: 'Foster Parent access required.' });
    }
    if (!Number.isSafeInteger(reportId) || reportId <= 0) {
        return res.status(400).json({ error: 'Invalid report ID.' });
    }
    const month = typeof req.body.reportingMonth === 'string' ? req.body.reportingMonth.trim() : '';
    const wellbeing = typeof req.body.wellbeingStatus === 'string' ? req.body.wellbeingStatus.trim() : '';
    const notes = typeof req.body.developmentalNotes === 'string' ? req.body.developmentalNotes.trim() : '';
    if (!month || month.length > 50 || !wellbeing || wellbeing.length > 50 || !notes || notes.length > 4000) {
        return res.status(400).json({ error: 'Provide a valid reporting month, well-being status and notes.' });
    }
    try {
        const pool = await getPool();
        const existing = await pool.request()
            .input('reportId', sql.Int, reportId)
            .input('parentId', sql.Int, parentId)
            .query(`
                SELECT r.ChildID
                FROM MONTHLY_REPORTS r
                WHERE r.ReportID = @reportId AND r.FosterParentID = @parentId
            `);
        if (!existing.recordset.length) return res.status(404).json({ error: 'Report not found.' });
        const childId = existing.recordset[0].ChildID;
        const placement = await pool.request()
            .input('childId', sql.Int, childId)
            .input('parentId', sql.Int, parentId)
            .query(`
                SELECT TOP 1 pr.CaseWorkerID
                FROM PLACEMENT_REQUESTS pr
                JOIN CHILD c ON c.ChildID = pr.ChildID
                WHERE pr.ChildID = @childId
                  AND pr.CandidateFosterParentID = @parentId
                  AND pr.Status = 'Approved'
                  AND c.CurrentPlacementStatus = 'Placed'
                ORDER BY pr.RequestID DESC
            `);
        if (!placement.recordset.length) {
            return res.status(403).json({ error: 'Only reports for your currently placed children can be edited.' });
        }
        const updated = await pool.request()
            .input('reportId', sql.Int, reportId)
            .input('parentId', sql.Int, parentId)
            .input('month', sql.VarChar(50), month)
            .input('wellbeing', sql.VarChar(50), wellbeing)
            .input('notes', sql.VarChar(sql.MAX), notes)
            .query(`
                UPDATE MONTHLY_REPORTS
                SET ReportingMonth = @month, WellbeingStatus = @wellbeing,
                    DevelopmentalNotes = @notes
                WHERE ReportID = @reportId AND FosterParentID = @parentId;
                SELECT @@ROWCOUNT AS UpdatedCount;
            `);
        if (!updated.recordset[0]?.UpdatedCount) {
            return res.status(404).json({ error: 'Report not found.' });
        }
        const workerId = placement.recordset[0].CaseWorkerID;
        if (workerId) {
            try {
                await notify(pool, workerId, parentId, 'REPORT_SUBMITTED',
                    'A foster parent has updated and resubmitted a monthly progress report for your review.',
                    'MONTHLY_REPORTS', reportId);
            } catch (notifyErr) {
                console.error('Report update notification:', notifyErr);
            }
        }
        await logEvent(pool, parentId, `Updated monthly report #${reportId} for child #${childId}`, req.ip);
        return res.json({ success: true });
    } catch (err) {
        console.error('Monthly report update:', err);
        return res.status(500).json({ error: 'Could not update monthly report.' });
    }
});

app.post('/api/fosterparent/reports', requireAuth, async (req, res) => {
    // Monthly child welfare reports can only be created by the
    // authenticated foster parent responsible for the placed child.
    const role = String(req.session.user.role || '').trim().toLowerCase();
    const loggedInId = Number(req.session.user.personId);
    const {
        childId,
        fosterParentId,
        reportingMonth,
        wellbeingStatus,
        developmentalNotes
    } = req.body;

    const requestedChildId = Number(childId);
    const requestedParentId = Number(fosterParentId);
    const month = typeof reportingMonth === 'string' ? reportingMonth.trim() : '';
    const wellbeing = typeof wellbeingStatus === 'string' ? wellbeingStatus.trim() : '';
    const notes = typeof developmentalNotes === 'string' ? developmentalNotes.trim() : '';

    if (
        role !== 'foster parent' ||
        !Number.isSafeInteger(loggedInId) || loggedInId <= 0 ||
        !Number.isSafeInteger(requestedParentId) || requestedParentId !== loggedInId
    ) {
        return res.status(403).json({ error: 'Foster Parent access required.' });
    }

    if (
        !Number.isSafeInteger(requestedChildId) || requestedChildId <= 0 ||
        !month || month.length > 50 ||
        !wellbeing || wellbeing.length > 50 ||
        !notes || notes.length > 4000
    ) {
        return res.status(400).json({
            error: 'Select a placed child and provide a valid month, well-being status and notes.'
        });
    }

    try {
        const pool = await getPool();
        const placement = await pool.request()
            .input('childId', sql.Int, requestedChildId)
            .input('parentId', sql.Int, loggedInId)
            .query(`
                SELECT TOP 1 pr.CaseWorkerID
                FROM PLACEMENT_REQUESTS pr
                JOIN CHILD c ON c.ChildID = pr.ChildID
                WHERE pr.ChildID = @childId
                  AND pr.CandidateFosterParentID = @parentId
                  AND pr.Status = 'Approved'
                  AND c.CurrentPlacementStatus = 'Placed'
                ORDER BY pr.RequestID DESC
            `);

        if (placement.recordset.length === 0) {
            return res.status(403).json({
                error: 'This child is not currently placed with your foster parent account.'
            });
        }

        await pool.request()
            .input('childId', sql.Int, requestedChildId)
            .input('fosterParentId', sql.Int, loggedInId)
            .input('reportingMonth', sql.VarChar(50), month)
            .input('wellbeingStatus', sql.VarChar(50), wellbeing)
            .input('notes', sql.VarChar(sql.MAX), notes)
            .query(`
                INSERT INTO MONTHLY_REPORTS (
                    ChildID, FosterParentID, ReportingMonth,
                    WellbeingStatus, DevelopmentalNotes
                ) VALUES (
                    @childId, @fosterParentId, @reportingMonth,
                    @wellbeingStatus, @notes
                )
            `);

        const workerId = placement.recordset[0].CaseWorkerID;
        if (workerId) {
            await notify(
                pool, workerId, loggedInId, 'REPORT_SUBMITTED',
                'A foster parent has submitted a new monthly progress report for your review.',
                'MONTHLY_REPORTS', null
            );
        }
        await logEvent(
            pool, loggedInId,
            `Submitted monthly report for child #${requestedChildId}`, req.ip
        );

        return res.json({ success: true });
    } catch (err) {
        console.error('Monthly report submission error:', err);
        return res.status(500).json({ error: 'Could not submit monthly report.' });
    }
});


/* ==========================================================
   NOTIFICATIONS -- used by the shared notification bell
   ========================================================== */

/* All inbox operations are scoped to the authenticated session.
   The client-supplied userId is only a route parameter, never authorization. */
function requireOwnNotifications(req, res, next) {
    const requestedId = Number(req.params.personId);
    const signedInId = Number(req.session?.user?.personId);
    if (!Number.isSafeInteger(requestedId) || requestedId <= 0 ||
        !Number.isSafeInteger(signedInId) || signedInId !== requestedId) {
        return res.status(403).json({ error: 'You can only access your own notifications.' });
    }
    next();
}



app.get('/api/notifications/:personId', requireAuth, requireOwnNotifications, async (req, res) => {
    try {
        const pool = await getPool();

        const result = await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.personId
            )
            .query(`
                SELECT TOP 30
                    NotificationID,
                    Message,
                    EventType,
                    IsRead,
                    CreatedAt
                FROM NOTIFICATIONS
                WHERE RecipientID = @id
                ORDER BY CreatedAt DESC
            `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.get('/api/notifications/:personId/unread-count', requireAuth, requireOwnNotifications, async (req, res) => {
    try {
        const pool = await getPool();

        const result = await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.personId
            )
            .query(`
                SELECT COUNT(*) AS count
                FROM NOTIFICATIONS
                WHERE
                    RecipientID = @id
                    AND IsRead = 0
            `);

        res.json({
            count: result.recordset[0].count
        });

    } catch (err) {
        console.error(err);

        res.json({
            count: 0
        });
    }
});


app.put('/api/notifications/:id/read', requireAuth, async (req, res) => {
    try {
        const pool = await getPool();

        const updateResult = await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.id
            )
            .input('recipientId', sql.Int, req.session.user.personId)
            .query(`
                UPDATE NOTIFICATIONS
                SET IsRead = 1
                WHERE NotificationID = @id AND RecipientID = @recipientId
            `);

        if (!updateResult.rowsAffected?.[0]) {
            return res.status(404).json({ error: 'Notification not found.' });
        }

        res.json({
            success: true
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.put('/api/notifications/:personId/read-all', requireAuth, requireOwnNotifications, async (req, res) => {
    try {
        const pool = await getPool();

        await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.personId
            )
            .query(`
                UPDATE NOTIFICATIONS
                SET IsRead = 1
                WHERE RecipientID = @id
            `);

        res.json({
            success: true
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


/* ==========================================================
   SOCIAL WORKER: view submitted Monthly Reports
   ========================================================== */

app.get('/api/socialworker/reports/:personId', requireAuth, requireSocialWorker, async (req, res) => {
    const loggedInId = Number(req.session.user.personId);
    const requestedId = Number(req.params.personId);
    if (
        !Number.isSafeInteger(requestedId) ||
        !Number.isSafeInteger(loggedInId) ||
        requestedId !== loggedInId
    ) {
        return res.status(403).json({ error: 'You can only view reports for your own caseload.' });
    }

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, loggedInId)
            .query(`
                SELECT
                    r.ReportID,
                    c.FullName AS ChildName,
                    fp.FullName AS FosterParentName,
                    r.ReportingMonth,
                    r.WellbeingStatus,
                    r.DevelopmentalNotes,
                    r.SubmittedAt
                FROM MONTHLY_REPORTS r
                JOIN CHILD c ON r.ChildID = c.ChildID
                JOIN PERSON fp ON r.FosterParentID = fp.PersonID
                WHERE c.CaseWorkerID = @id
                ORDER BY r.SubmittedAt DESC
            `);
        return res.json(result.recordset);
    } catch (err) {
        console.error('Monthly reports retrieval error:', err);
        return res.status(500).json({ error: 'Could not load monthly reports.' });
    }
});


/* ==========================================================
   SOCIAL WORKER: update a foster parent's background check /
   home evaluation score
   ========================================================== */

app.put('/api/socialworker/foster-parents/:id/evaluation', async (req, res) => {

    const {
        backgroundCheckStatus,
        homeEvaluationScore,
        actingPersonId
    } = req.body;

    try {
        const pool = await getPool();

        const existing = await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.id
            )
            .query(`
                SELECT ProfileID
                FROM FOSTER_PARENT_PROFILE
                WHERE PersonID = @id
            `);

        if (existing.recordset.length === 0) {

            await pool.request()
                .input(
                    'id',
                    sql.Int,
                    req.params.id
                )
                .input(
                    'status',
                    sql.VarChar,
                    backgroundCheckStatus || 'Pending'
                )
                .input(
                    'score',
                    sql.Decimal(4, 1),
                    homeEvaluationScore || null
                )
                .query(`
                    INSERT INTO FOSTER_PARENT_PROFILE (
                        PersonID,
                        BackgroundCheckStatus,
                        HomeEvaluationScore
                    )
                    VALUES (
                        @id,
                        @status,
                        @score
                    )
                `);

        } else {

            await pool.request()
                .input(
                    'id',
                    sql.Int,
                    req.params.id
                )
                .input(
                    'status',
                    sql.VarChar,
                    backgroundCheckStatus || 'Pending'
                )
                .input(
                    'score',
                    sql.Decimal(4, 1),
                    homeEvaluationScore || null
                )
                .query(`
                    UPDATE FOSTER_PARENT_PROFILE
                    SET
                        BackgroundCheckStatus = @status,
                        HomeEvaluationScore = @score
                    WHERE PersonID = @id
                `);
        }

        await notify(
            pool,
            req.params.id,
            actingPersonId,
            'EVALUATION_UPDATED',
            'Your background check and/or home evaluation has been updated by your social worker.',
            'FOSTER_PARENT_PROFILE',
            null
        );

        await logEvent(
            pool,
            actingPersonId,
            `Updated evaluation for foster parent #${req.params.id}`,
            req.ip
        );

        res.json({
            success: true
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


/* ==========================================================
   SOCIAL WORKER: record stipend disbursements
   ========================================================== */

app.get('/api/socialworker/stipends/:personId', async (req, res) => {
    try {
        const pool = await getPool();

        const result = await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.personId
            )
            .query(`
                SELECT
                    s.StipendID,
                    c.FullName AS ChildName,
                    fp.FullName AS FosterParentName,
                    s.Amount,
                    s.DisbursementMonth,
                    s.ReferenceNumber,
                    s.Status
                FROM STIPENDS s
                JOIN CHILD c
                    ON s.ChildID = c.ChildID
                JOIN PERSON fp
                    ON s.FosterParentID = fp.PersonID
                WHERE c.CaseWorkerID = @id
                ORDER BY s.StipendID DESC
            `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.post('/api/socialworker/stipends', async (req, res) => {

    const {
        childId,
        fosterParentId,
        amount,
        disbursementMonth,
        actingPersonId
    } = req.body;

    if (
        !childId ||
        !fosterParentId ||
        !amount ||
        !disbursementMonth
    ) {
        return res.status(400).json({
            error:
                'Child, foster parent, amount, and month are all required.'
        });
    }

    try {
        const pool = await getPool();

        const insertResult = await pool.request()
            .input('childId', sql.Int, childId)
            .input(
                'fosterParentId',
                sql.Int,
                fosterParentId
            )
            .input(
                'amount',
                sql.Decimal(10, 2),
                amount
            )
            .input(
                'month',
                sql.VarChar,
                disbursementMonth
            )
            .input(
                'refNumber',
                sql.VarChar,
                'TEMP-' + Date.now()
            )
            .query(`
                INSERT INTO STIPENDS (
                    ChildID,
                    FosterParentID,
                    Amount,
                    DisbursementMonth,
                    ReferenceNumber,
                    Status
                )

                OUTPUT INSERTED.StipendID

                VALUES (
                    @childId,
                    @fosterParentId,
                    @amount,
                    @month,
                    @refNumber,
                    'Paid'
                )
            `);

        const newId =
            insertResult.recordset[0].StipendID;

        await pool.request()
            .input(
                'id',
                sql.Int,
                newId
            )
            .input(
                'ref',
                sql.VarChar,
                'SASSA-EC-' + (8900 + newId)
            )
            .query(`
                UPDATE STIPENDS
                SET ReferenceNumber = @ref
                WHERE StipendID = @id
            `);

        await notify(
            pool,
            fosterParentId,
            actingPersonId,
            'STIPEND_RECORDED',
            `A stipend payment for ${disbursementMonth} has been recorded for your account.`,
            'STIPENDS',
            newId
        );

        await logEvent(
            pool,
            actingPersonId,
            `Recorded stipend for child #${childId}`,
            req.ip
        );

        res.json({
            success: true
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


/* ==========================================================
   SOCIAL WORKER: review documents submitted by biological parents
   ========================================================== */

/* ==========================================================
   FOSTER PARENT: submit a real application
   ========================================================== */

app.get('/api/fosterparent/applications/:personId', async (req, res) => {
    try {
        const pool = await getPool();

        const result = await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.personId
            )
            .query(`
                SELECT
                    AppID,
                    Status,
                    SubmissionDate
                FROM APPLICATIONS
                WHERE ApplicantPersonID = @id
                ORDER BY SubmissionDate DESC
            `);

        res.json(result.recordset);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


app.post('/api/fosterparent/applications', async (req, res) => {

    const {
        applicantId
    } = req.body;

    if (!applicantId) {
        return res.status(400).json({
            error: 'Missing applicant.'
        });
    }

    try {
        const pool = await getPool();

        const applicationInsert = await pool.request()
            .input('id', sql.Int, applicantId)
            .query(`
                INSERT INTO APPLICATIONS (ApplicantPersonID, Status)
                OUTPUT INSERTED.AppID
                VALUES (@id, 'Pending')
            `);

        // Inform active Social Workers that a new application is awaiting review.
        const reviewers = await pool.request().query(`
            SELECT p.PersonID
            FROM PERSON p
            INNER JOIN ROLES r ON r.RoleID = p.RoleID
            WHERE LOWER(LTRIM(RTRIM(r.RoleName))) = 'social worker'
              AND p.Status = 'Active'
        `);
        for (const reviewer of reviewers.recordset) {
            await notify(pool, reviewer.PersonID, Number(applicantId),
                'FOSTER_APPLICATION_SUBMITTED',
                `A new foster parent application #${applicationInsert.recordset[0].AppID} is awaiting review.`,
                'APPLICATIONS', applicationInsert.recordset[0].AppID);
        }

        await logEvent(
            pool,
            applicantId,
            'Submitted a new foster parent application',
            req.ip
        );

        res.json({
            success: true
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});
/* ==========================================================
   ADMIN: create a brand-new user account
   ========================================================== */

app.post('/api/admin/users', async (req, res) => {

    const {
        fullName,
        email,
        password,
        roleId,
        phone,
        regionDistrict,
        actingPersonId
    } = req.body;

    if (
        !fullName ||
        !email ||
        !password ||
        !roleId
    ) {
        return res.status(400).json({
            error:
                'Full name, email, password, and role are all required.'
        });
    }

    try {
        const pool = await getPool();

        const passwordHash =
            await bcrypt.hash(password, 10);

        await pool.request()
            .input(
                'fullName',
                sql.VarChar,
                fullName
            )
            .input(
                'email',
                sql.VarChar,
                email
            )
            .input(
                'passwordHash',
                sql.VarChar,
                passwordHash
            )
            .input(
                'roleId',
                sql.Int,
                roleId
            )
            .input(
                'phone',
                sql.VarChar,
                phone || null
            )
            .input(
                'region',
                sql.VarChar,
                regionDistrict || null
            )
            .query(`
                INSERT INTO PERSON (
                    FullName,
                    Email,
                    PasswordHash,
                    RoleID,
                    Phone,
                    RegionDistrict,
                    Status
                )

                VALUES (
                    @fullName,
                    @email,
                    @passwordHash,
                    @roleId,
                    @phone,
                    @region,
                    'Active'
                )
            `);

        await logEvent(
            pool,
            actingPersonId || null,
            `Created new user account: ${email}`,
            req.ip
        );

        res.json({
            success: true
        });

    } catch (err) {

        console.error(err);

        if (
            err.message &&
            err.message.includes('UNIQUE')
        ) {
            return res.status(409).json({
                error:
                    'An account with that email already exists.'
            });
        }

        res.status(500).json({
            error: err.message
        });
    }
});


/* ==========================================================
   CHANGE PASSWORD -- works for any logged-in user, any role
   ========================================================== */

app.put('/api/change-password/:personId', async (req, res) => {

    const {
        currentPassword,
        newPassword
    } = req.body;

    if (
        !currentPassword ||
        !newPassword
    ) {
        return res.status(400).json({
            error:
                'Both current and new password are required.'
        });
    }

    try {
        const pool = await getPool();

        const result = await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.personId
            )
            .query(`
                SELECT PasswordHash
                FROM PERSON
                WHERE PersonID = @id
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({
                error: 'Account not found.'
            });
        }

        const matches =
            await bcrypt.compare(
                currentPassword,
                result.recordset[0].PasswordHash
            );

        if (!matches) {
            return res.status(401).json({
                error:
                    'Current password is incorrect.'
            });
        }

        const newHash =
            await bcrypt.hash(newPassword, 10);

        await pool.request()
            .input(
                'id',
                sql.Int,
                req.params.personId
            )
            .input(
                'hash',
                sql.VarChar,
                newHash
            )
            .query(`
                UPDATE PERSON
                SET PasswordHash = @hash
                WHERE PersonID = @id
            `);

        await logEvent(
            pool,
            req.params.personId,
            'Changed own password',
            req.ip
        );

        res.json({
            success: true
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});


/* ==========================================================
   PUBLIC SIGN-UP

   Foster Parents and Biological Parents only.

   Staff roles are still created by an Administrator.

   Public accounts must verify their email address before
   they can use the account.
   ========================================================== */

app.get('/api/public-roles', async (req, res) => {

    try {
        const pool = await getPool();

        const result = await pool.request()
            .query(`
                SELECT
                    RoleID,
                    RoleName
                FROM ROLES
                WHERE RoleName IN (
                    'Foster Parent',
                    'Biological Parent'
                )
            `);

        res.json(result.recordset);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
});

/* ==========================================================
   PUBLIC SIGN-UP
   ========================================================== */

app.post('/api/signup', async (req, res) => {

    const {
        fullName,
        email,
        password,
        roleId
    } = req.body;


    // =====================================================
    // VALIDATE REQUIRED FIELDS
    // =====================================================

    if (
        !fullName ||
        !email ||
        !password ||
        !roleId
    ) {

        return res.status(400).json({
            error:
                'Full name, email, password, and role are all required.'
        });

    }


    const cleanEmail =
        email.trim().toLowerCase();


    try {

        const pool =
            await getPool();


        // =====================================================
        // 1. ONLY ALLOW PUBLIC REGISTRATION ROLES
        // =====================================================

        const allowedRole =
            await pool.request()

                .input(
                    'id',
                    sql.Int,
                    roleId
                )

                .query(`
                    SELECT RoleID

                    FROM ROLES

                    WHERE
                        RoleID = @id

                        AND RoleName IN (
                            'Foster Parent',
                            'Biological Parent'
                        )
                `);


        if (
            allowedRole.recordset.length === 0
        ) {

            return res.status(400).json({
                error:
                    'That role is not available for self-registration.'
            });

        }


        // =====================================================
        // 2. CHECK WHETHER EMAIL ALREADY EXISTS
        // =====================================================

        const existingUser =
            await pool.request()

                .input(
                    'email',
                    sql.VarChar,
                    cleanEmail
                )

                .query(`
                    SELECT
                        PersonID

                    FROM PERSON

                    WHERE Email = @email
                `);


        if (
            existingUser.recordset.length > 0
        ) {

            return res.status(409).json({
                error:
                    'An account with that email already exists.'
            });

        }


        // =====================================================
        // 3. HASH PASSWORD
        // =====================================================

        const passwordHash =
            await bcrypt.hash(
                password,
                10
            );


        // =====================================================
        // 4. CREATE ACTIVE ACCOUNT
        // =====================================================

        const insertResult =
            await pool.request()

                .input(
                    'fullName',
                    sql.VarChar,
                    fullName.trim()
                )

                .input(
                    'email',
                    sql.VarChar,
                    cleanEmail
                )

                .input(
                    'passwordHash',
                    sql.VarChar,
                    passwordHash
                )

                .input(
                    'roleId',
                    sql.Int,
                    roleId
                )

                .query(`
                    INSERT INTO PERSON (
                        FullName,
                        Email,
                        PasswordHash,
                        RoleID,
                        Status
                    )

                    OUTPUT INSERTED.PersonID

                    VALUES (
                        @fullName,
                        @email,
                        @passwordHash,
                        @roleId,
                        'Active'
                    )
                `);


        const newPersonId =
            insertResult.recordset[0].PersonID;


        // =====================================================
        // 5. AUDIT LOG
        // =====================================================

        await logEvent(
            pool,
            newPersonId,
            `New account registered: ${cleanEmail}`,
            req.ip
        );


        // =====================================================
        // 6. SUCCESS
        // =====================================================

        res.json({

            success: true,

            email: cleanEmail,

            message:
                'Account created successfully. You can now sign in.'

        });


    } catch (err) {

        console.error(
            'Signup error:',
            err
        );


        if (
            err.message &&
            err.message
                .toUpperCase()
                .includes('UNIQUE')
        ) {

            return res.status(409).json({
                error:
                    'An account with that email already exists.'
            });

        }


        res.status(500).json({
            error:
                'Server error while creating your account.'
        });

    }

});
/* ==========================================================
   ADOPTION CASE REVIEW REQUESTS
   ========================================================== */

app.get('/api/adoption/parent/children', requireAuth, requireBiologicalParent, async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('parentId', sql.Int, Number(req.session.user.personId))
            .query(`SELECT ChildID, FullName, CurrentPlacementStatus
                    FROM CHILD WHERE BiologicalParentID = @parentId
                    ORDER BY FullName`);
        return res.json(result.recordset);
    } catch (err) {
        console.error('Adoption parent children:', err);
        return res.status(500).json({ error: 'Could not load children.' });
    }
});

app.get('/api/adoption/parent/requests', requireAuth, requireBiologicalParent, async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('parentId', sql.Int, Number(req.session.user.personId))
            .query(`SELECT ar.RequestID, ar.ChildID, c.FullName AS ChildName,
                           ar.BiologicalParentID, ar.Reason, ar.Status,
                           ar.WorkerNotes, ar.CreatedAt, ar.ReviewedAt,
                           mr.Decision AS ManagerDecision,
                           mr.Notes AS ManagerNotes,
                           mr.FinalSignoff AS FinalSignoff, mr.FinalMessage AS FinalMessage,
                           mr.ReviewedAt AS ManagerReviewedAt
                    FROM ADOPTION_REQUESTS ar
                    INNER JOIN CHILD c ON c.ChildID = ar.ChildID
                    LEFT JOIN dbo.ADOPTION_MANAGER_REVIEWS mr ON mr.RequestID = ar.RequestID
                    WHERE ar.BiologicalParentID = @parentId
                    ORDER BY ar.CreatedAt DESC, ar.RequestID DESC`);
        return res.json(result.recordset);
    } catch (err) {
        console.error('Adoption parent requests:', err);
        return res.status(500).json({ error: 'Could not load adoption requests.' });
    }
});

app.post('/api/adoption/parent/requests', requireAuth, requireBiologicalParent, async (req, res) => {
    const parentId = Number(req.session.user.personId);
    const childId = Number(req.body?.childId ?? req.body?.ChildID);
    const reason = String(req.body?.reason ?? req.body?.Reason ?? '').trim();
    if (!Number.isSafeInteger(childId) || childId <= 0 || !reason || reason.length > 4000) {
        return res.status(400).json({ error: 'Select a child and enter a reason (up to 4000 characters).' });
    }
    let transaction;
    let active = false;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();
        active = true;
        const childResult = await new sql.Request(transaction)
            .input('childId', sql.Int, childId)
            .input('parentId', sql.Int, parentId)
            .query(`SELECT ChildID, CaseWorkerID FROM CHILD WITH (UPDLOCK, HOLDLOCK)
                    WHERE ChildID = @childId AND BiologicalParentID = @parentId`);
        const child = childResult.recordset[0];
        if (!child) {
            await transaction.rollback(); active = false;
            return res.status(404).json({ error: 'Child not found under your account.' });
        }
        if (!child.CaseWorkerID) {
            await transaction.rollback(); active = false;
            return res.status(409).json({ error: 'This child does not have an assigned social worker.' });
        }
        const duplicate = await new sql.Request(transaction)
            .input('childId', sql.Int, childId)
            .input('parentId', sql.Int, parentId)
            .query(`SELECT TOP 1 RequestID FROM ADOPTION_REQUESTS WITH (UPDLOCK, HOLDLOCK)
                    WHERE ChildID = @childId AND BiologicalParentID = @parentId
                      AND Status IN ('Submitted', 'Under Review')`);
        if (duplicate.recordset.length) {
            await transaction.rollback(); active = false;
            return res.status(409).json({ error: 'An adoption assessment request is already pending for this child.' });
        }
        const identityResult = await new sql.Request(transaction)
            .query(`SELECT COLUMNPROPERTY(OBJECT_ID('ADOPTION_REQUESTS'), 'RequestID', 'IsIdentity') AS IsIdentity`);
        const isIdentity = identityResult.recordset[0]?.IsIdentity;
        if (isIdentity !== 0 && isIdentity !== 1) throw new Error('Cannot determine RequestID identity configuration.');
        let inserted;
        if (isIdentity === 1) {
            inserted = await new sql.Request(transaction)
                .input('childId', sql.Int, childId)
                .input('parentId', sql.Int, parentId)
                .input('reason', sql.NVarChar(4000), reason)
                .query(`INSERT INTO ADOPTION_REQUESTS (ChildID, BiologicalParentID, Reason, Status, CreatedAt)
                        OUTPUT INSERTED.RequestID
                        VALUES (@childId, @parentId, @reason, 'Submitted', SYSDATETIME())`);
        } else {
            const next = await new sql.Request(transaction)
                .query(`SELECT ISNULL(MAX(RequestID), 0) + 1 AS NextId
                        FROM ADOPTION_REQUESTS WITH (TABLOCKX, HOLDLOCK)`);
            inserted = await new sql.Request(transaction)
                .input('id', sql.Int, next.recordset[0].NextId)
                .input('childId', sql.Int, childId)
                .input('parentId', sql.Int, parentId)
                .input('reason', sql.NVarChar(4000), reason)
                .query(`INSERT INTO ADOPTION_REQUESTS
                        (RequestID, ChildID, BiologicalParentID, Reason, Status, CreatedAt)
                        OUTPUT INSERTED.RequestID
                        VALUES (@id, @childId, @parentId, @reason, 'Submitted', SYSDATETIME())`);
        }
        const requestId = inserted.recordset[0].RequestID;
        await transaction.commit(); active = false;
        await notify(pool, Number(child.CaseWorkerID), parentId, 'ADOPTION_REVIEW_REQUEST',
            `A biological parent submitted an adoption case review request for child #${childId}.`,
            'ADOPTION_REQUESTS', requestId);
        await logEvent(pool, parentId, `Submitted adoption case review request #${requestId}`, req.ip);
        return res.status(201).json({ success: true, RequestID: requestId, requestId, Status: 'Submitted', message: 'Request sent to the assigned social worker.' });
    } catch (err) {
        if (active) { try { await transaction.rollback(); } catch (_) {} }
        console.error('Submit adoption request:', err);
        return res.status(500).json({ error: 'Could not submit the adoption case review request.' });
    }
});

// Biological parents can change only their own requests that have not entered review.
app.patch('/api/adoption/parent/requests/:id', requireAuth, requireBiologicalParent, async (req, res) => {
    const requestId = Number(req.params.id);
    const parentId = Number(req.session.user.personId);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!Number.isSafeInteger(requestId) || requestId <= 0 || reason.length < 10 || reason.length > 2000) {
        return res.status(400).json({ error: 'Enter a valid request and reason (10–2000 characters).' });
    }
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, requestId)
            .input('parentId', sql.Int, parentId)
            .input('reason', sql.NVarChar(2000), reason)
            .query(`UPDATE ADOPTION_REQUESTS SET Reason = @reason
                    OUTPUT INSERTED.RequestID
                    WHERE RequestID = @id AND BiologicalParentID = @parentId AND Status = 'Submitted'`);
        if (!result.recordset.length) return res.status(409).json({ error: 'Request not found or already under review. Refresh the list.' });
        await logEvent(pool, parentId, `Edited adoption case review request #${requestId}`, req.ip);
        return res.json({ success: true, message: 'Request updated.' });
    } catch (err) {
        console.error('Edit adoption request:', err);
        return res.status(500).json({ error: 'Could not update the adoption request.' });
    }
});

// Deletion is limited to an unreviewed request owned by the logged-in parent.
app.delete('/api/adoption/parent/requests/:id', requireAuth, requireBiologicalParent, async (req, res) => {
    const requestId = Number(req.params.id);
    const parentId = Number(req.session.user.personId);
    if (!Number.isSafeInteger(requestId) || requestId <= 0) {
        return res.status(400).json({ error: 'Invalid request ID.' });
    }
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, requestId)
            .input('parentId', sql.Int, parentId)
            .query(`DELETE FROM ADOPTION_REQUESTS OUTPUT DELETED.RequestID
                    WHERE RequestID = @id AND BiologicalParentID = @parentId AND Status = 'Submitted'`);
        if (!result.recordset.length) return res.status(409).json({ error: 'Request not found or already under review. Refresh the list.' });
        await logEvent(pool, parentId, `Deleted unreviewed adoption case review request #${requestId}`, req.ip);
        return res.json({ success: true, message: 'Request deleted.' });
    } catch (err) {
        console.error('Delete adoption request:', err);
        return res.status(500).json({ error: 'Could not delete the adoption request. It may have linked records.' });
    }
});

app.get('/api/adoption/socialworker/requests', requireAuth, requireSocialWorker, async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('workerId', sql.Int, Number(req.session.user.personId))
            .query(`SELECT ar.RequestID, ar.ChildID, c.FullName AS ChildName,
                           bp.FullName AS BiologicalParentName,
                           ar.BiologicalParentID, ar.Reason, ar.Status,
                           ar.WorkerNotes, ar.CreatedAt, ar.ReviewedAt,
                           mr.Decision AS ManagerDecision, mr.Notes AS ManagerNotes,
                           mr.FinalSignoff AS FinalSignoff, mr.FinalMessage AS FinalMessage
                    FROM ADOPTION_REQUESTS ar
                    INNER JOIN CHILD c ON c.ChildID = ar.ChildID
                    INNER JOIN PERSON bp ON bp.PersonID = ar.BiologicalParentID
                    LEFT JOIN dbo.ADOPTION_MANAGER_REVIEWS mr ON mr.RequestID = ar.RequestID
                    WHERE c.CaseWorkerID = @workerId
                    ORDER BY ar.CreatedAt DESC, ar.RequestID DESC`);
        return res.json(result.recordset);
    } catch (err) {
        console.error('Social worker adoption requests:', err);
        return res.status(500).json({ error: 'Could not load assigned adoption requests.' });
    }
});

// Assigned social workers may record assessments, but not finalize an adoption.
app.patch('/api/adoption/socialworker/requests/:id', requireAuth, requireSocialWorker, async (req, res) => {
    const requestId = Number(req.params.id);
    const workerId = Number(req.session.user.personId);
    const status = req.body?.status;
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
    const allowed = ['Under Review', 'More Information Required', 'Recommended', 'Not Recommended'];

    if (!Number.isSafeInteger(requestId) || requestId <= 0 ||
        !allowed.includes(status) || !notes || notes.length > 2000) {
        return res.status(400).json({ error: 'Choose a valid assessment outcome and enter notes (up to 2000 characters).' });
    }

    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('id', sql.Int, requestId)
            .input('workerId', sql.Int, workerId)
            .input('status', sql.VarChar(40), status)
            .input('notes', sql.NVarChar(2000), notes)
            .query(`UPDATE ar
                    SET ar.Status = @status,
                        ar.WorkerNotes = @notes,
                        ar.ReviewedAt = SYSDATETIME()
                    OUTPUT INSERTED.RequestID, INSERTED.BiologicalParentID
                    FROM ADOPTION_REQUESTS ar
                    INNER JOIN CHILD c ON c.ChildID = ar.ChildID
                    WHERE ar.RequestID = @id
                      AND c.CaseWorkerID = @workerId
                      AND ar.Status IN ('Submitted', 'Under Review', 'More Information Required', 'Recommended', 'Not Recommended')`);
        if (!result.recordset.length) {
            return res.status(409).json({ error: 'Request is not assigned to you or is no longer open for review. Refresh the list.' });
        }
        const parentId = result.recordset[0].BiologicalParentID;
        await notify(pool, parentId, workerId, 'ADOPTION_REVIEW_UPDATE',
            `Your adoption case review request #${requestId} is now ${status}.`,
            'ADOPTION_REQUESTS', requestId);
        if (status === 'Recommended' || status === 'Not Recommended') {
            const managers = await pool.request().query(`
                SELECT p.PersonID FROM PERSON p
                INNER JOIN ROLES r ON r.RoleID = p.RoleID
                WHERE LOWER(LTRIM(RTRIM(r.RoleName))) = 'agency manager'
                  AND p.Status = 'Active'
            `);
            for (const manager of managers.recordset) {
                await notify(pool, manager.PersonID, workerId,
                    'ADOPTION_RECOMMENDATION_READY',
                    `Adoption case #${requestId} has a Social Worker recommendation and is ready for agency review.`,
                    'ADOPTION_REQUESTS', requestId);
            }
        }
        await logEvent(pool, workerId, `Updated adoption case review request #${requestId} to ${status}`, req.ip);
        return res.json({ success: true, RequestID: requestId, Status: status, message: 'Assessment saved.' });
    } catch (err) {
        console.error('Save adoption assessment:', err);
        return res.status(500).json({ error: 'Could not save the adoption assessment.' });
    }
});


app.get('/api/adoption/manager/requests',requireAuth,requireAgencyManager,async(req,res)=>{
 try{const pool=await getPool();const result=await pool.request().query(`
 SELECT ar.RequestID,c.FullName AS ChildName,bp.FullName AS BiologicalParentName,
 sw.FullName AS SocialWorkerName,ar.Reason,ar.Status,ar.WorkerNotes,
 mr.Decision AS ManagerDecision,mr.Notes AS ManagerNotes, mr.FinalSignoff AS FinalSignoff, mr.FinalMessage AS FinalMessage
 FROM dbo.ADOPTION_REQUESTS ar JOIN dbo.CHILD c ON c.ChildID=ar.ChildID
 JOIN dbo.PERSON bp ON bp.PersonID=ar.BiologicalParentID
 LEFT JOIN dbo.PERSON sw ON sw.PersonID=c.CaseWorkerID
 LEFT JOIN dbo.ADOPTION_MANAGER_REVIEWS mr ON mr.RequestID=ar.RequestID
 ORDER BY ar.CreatedAt DESC,ar.RequestID DESC`);return res.json(result.recordset);
 }catch(error){console.error('Manager adoption list:',error);return res.status(500).json({error:'Could not load manager adoption reviews. Run the included SQL migration first.'});}
});
app.put('/api/adoption/manager/requests/:id/review',requireAuth,requireAgencyManager,async(req,res)=>{
 const id=Number(req.params.id),managerId=Number(req.session.user.personId);
 const decision=req.body?.decision,notes=typeof req.body?.notes==='string'?req.body.notes.trim():'';
 if(!Number.isSafeInteger(id)||id<=0||!['Endorsed for Statutory Processing','Returned for More Information','Not Endorsed'].includes(decision)||!notes||notes.length>2000)
 return res.status(400).json({error:'Select an outcome and enter review notes (1–2000 characters).'});
 let tx;
 try{const pool=await getPool();tx=new sql.Transaction(pool);await tx.begin();
 const found=await new sql.Request(tx).input('id',sql.Int,id).query(`SELECT Status FROM dbo.ADOPTION_REQUESTS WITH(UPDLOCK,HOLDLOCK) WHERE RequestID=@id`);
 if(!found.recordset.length||!['Recommended','Not Recommended'].includes(found.recordset[0].Status)){
 await tx.rollback();tx=null;return res.status(409).json({error:'A completed social worker recommendation is required.'});}
 await new sql.Request(tx).input('id',sql.Int,id).input('managerId',sql.Int,managerId)
 .input('decision',sql.NVarChar(60),decision).input('notes',sql.NVarChar(2000),notes).query(`
 UPDATE dbo.ADOPTION_MANAGER_REVIEWS WITH(UPDLOCK,SERIALIZABLE)
 SET ManagerPersonID=@managerId,Decision=@decision,Notes=@notes,FinalSignoff=NULL,FinalMessage=NULL,FinalSignedAt=NULL,ReviewedAt=SYSDATETIME() WHERE RequestID=@id;
 IF @@ROWCOUNT=0 INSERT INTO dbo.ADOPTION_MANAGER_REVIEWS(RequestID,ManagerPersonID,Decision,Notes)
 VALUES(@id,@managerId,@decision,@notes);`);
 await tx.commit();tx=null;
 const recipient=await pool.request().input('id',sql.Int,id)
 .query('SELECT BiologicalParentID FROM dbo.ADOPTION_REQUESTS WHERE RequestID=@id');
 if(recipient.recordset.length){
 await notify(pool,recipient.recordset[0].BiologicalParentID,managerId,
 'ADOPTION_MANAGER_REVIEW',
 `Agency review recorded for adoption request #${id}: ${decision}.`,
 'ADOPTION_REQUESTS',id);
 }
  const caseWorker = await pool.request().input('id',sql.Int,id).query(`
      SELECT c.CaseWorkerID FROM ADOPTION_REQUESTS ar
      JOIN CHILD c ON c.ChildID = ar.ChildID WHERE ar.RequestID = @id
  `);
  if (caseWorker.recordset[0]?.CaseWorkerID) {
      await notify(pool,caseWorker.recordset[0].CaseWorkerID,managerId,
          'ADOPTION_MANAGER_REVIEW',
          `Agency review recorded for adoption request #${id}: ${decision}.`,
          'ADOPTION_REQUESTS',id);
  }
 await logEvent(pool,managerId,`Recorded manager review for adoption case #${id}: ${decision}`,req.ip);
 return res.json({success:true,message:'Manager review saved. No legal adoption approval or custody change.'});
 }catch(error){if(tx)try{await tx.rollback();}catch(_){}console.error('Manager adoption save:',error);return res.status(500).json({error:'Could not save manager review.'});}
});


// Agency case sign-off is an internal workflow decision, not a legal adoption order.
app.put('/api/adoption/manager/requests/:id/final-signoff', requireAuth, requireAgencyManager, async (req,res)=>{
 const id=Number(req.params.id), managerId=Number(req.session.user.personId);
 const message=typeof req.body?.message==='string'?req.body.message.trim():'';
 if(!Number.isSafeInteger(id)||id<=0||!message||message.length>2000)
   return res.status(400).json({error:'Enter a final case message (1–2000 characters).'});
 let tx;
 try{
  const pool=await getPool(); tx=new sql.Transaction(pool); await tx.begin();
  const record=await new sql.Request(tx).input('id',sql.Int,id).query(`
   SELECT ar.Status,mr.Decision,c.CaseWorkerID,ar.BiologicalParentID,
          (SELECT TOP 1 fp.PersonID FROM dbo.FOSTER_PARENT_PROFILE fp
           JOIN dbo.PLACEMENT_REQUESTS pr ON pr.CandidateFosterParentID=fp.PersonID
           WHERE pr.ChildID=ar.ChildID ORDER BY pr.RequestID DESC) AS FosterParentID
   FROM dbo.ADOPTION_REQUESTS ar WITH(UPDLOCK,HOLDLOCK)
   JOIN dbo.CHILD c ON c.ChildID=ar.ChildID
   LEFT JOIN dbo.ADOPTION_MANAGER_REVIEWS mr ON mr.RequestID=ar.RequestID
   WHERE ar.RequestID=@id`);
  const item=record.recordset[0];
  if(!item||item.Status!=='Recommended'||item.Decision!=='Endorsed for Statutory Processing'){
   await tx.rollback();tx=null;
   return res.status(409).json({error:'The social worker must recommend the case and the manager must endorse it before final agency sign-off.'});
  }
  await new sql.Request(tx).input('id',sql.Int,id).input('managerId',sql.Int,managerId)
   .input('message',sql.NVarChar(2000),message).query(`
    UPDATE dbo.ADOPTION_MANAGER_REVIEWS
    SET FinalSignoff='Approved for Statutory Referral',FinalMessage=@message,
        FinalSignedAt=SYSDATETIME(),ManagerPersonID=@managerId WHERE RequestID=@id`);
  await tx.commit();tx=null;
  const roleMessages = [
   [item.BiologicalParentID, `Your child's adoption case #${id} has been approved by the Agency Manager for statutory referral. Manager message: ${message}. This is not confirmation of a legally completed adoption.`],
   [item.FosterParentID, `Adoption case #${id} has received final agency sign-off for statutory referral. Manager message: ${message}. You have not yet legally adopted the child through this action.`],
   [item.CaseWorkerID, `Adoption case #${id} has received final agency sign-off for statutory referral. Manager message: ${message}. This is not a legal adoption order.`]
  ];
  const sentTo = new Set();
  for (const [personId, notificationMessage] of roleMessages) {
   if (!personId || sentTo.has(Number(personId))) continue;
   sentTo.add(Number(personId));
   try {
    await pool.request()
     .input('recipientId',sql.Int,Number(personId))
     .input('senderId',sql.Int,managerId)
     .input('eventType',sql.VarChar(80),'ADOPTION_AGENCY_SIGNOFF')
     .input('message',sql.VarChar(sql.MAX),notificationMessage)
     .input('relatedId',sql.Int,id)
     .query(`INSERT INTO NOTIFICATIONS (RecipientID,SenderID,EventType,Message,RelatedTable,RelatedID)
             VALUES (@recipientId,@senderId,@eventType,@message,'ADOPTION_REQUESTS',@relatedId)`);
   } catch (notificationError) {
    console.error(`Adoption sign-off notification failed for recipient ${personId}:`,notificationError);
   }
  }
  await logEvent(pool,managerId,`Signed off adoption case #${id} for statutory referral`,req.ip);
  return res.json({success:true,message:'Agency sign-off recorded and notifications queued. Legal adoption and custody status remain unchanged.'});
 }catch(error){if(tx)try{await tx.rollback();}catch(_){}console.error('Adoption sign-off:',error);
 return res.status(500).json({error:'Could not record final agency sign-off. Ensure the SQL migration has been run.'});}
});

// Self-service account deletion. Child welfare and other referenced records are retained.
app.post('/api/account/delete-my-account', requireAuth, async (req, res) => {
    const personId = Number(req.session.user.personId);
    const password = req.body?.password;
    if (!Number.isSafeInteger(personId) || personId <= 0 ||
        typeof password !== 'string' || !password || password.length > 1024) {
        return res.status(400).json({ error: 'Enter your current password to confirm deletion.' });
    }

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        const account = await new sql.Request(transaction)
            .input('personId', sql.Int, personId)
            .query(`SELECT PersonID, PasswordHash FROM dbo.PERSON WITH (UPDLOCK, HOLDLOCK)
                    WHERE PersonID = @personId`);
        if (!account.recordset.length) {
            await transaction.rollback(); transaction = null;
            return res.status(404).json({ error: 'Account not found.' });
        }
        const matches = await bcrypt.compare(password, account.recordset[0].PasswordHash || '');
        if (!matches) {
            await transaction.rollback(); transaction = null;
            return res.status(403).json({ error: 'Incorrect password. Account was not deleted.' });
        }

        // All direct foreign-key references to PERSON are checked, not just case tables.
        const references = await new sql.Request(transaction).query(`
            SELECT QUOTENAME(SCHEMA_NAME(t.schema_id)) + '.' + QUOTENAME(t.name) AS TableName,
                   QUOTENAME(c.name) AS ColumnName
            FROM sys.foreign_key_columns fkc
            JOIN sys.tables t ON t.object_id = fkc.parent_object_id
            JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
            JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
            WHERE fkc.referenced_object_id = OBJECT_ID('dbo.PERSON') AND rc.name = 'PersonID'
        `);
        const linkedTables = new Set();
        for (const ref of references.recordset) {
            const linked = await new sql.Request(transaction)
                .input('personId', sql.Int, personId)
                .query(`SELECT TOP (1) 1 AS Linked FROM ${ref.TableName} WITH (HOLDLOCK) WHERE ${ref.ColumnName} = @personId`);
            if (linked.recordset.length) linkedTables.add(ref.TableName);
        }
        const auditTable = '[dbo].[AUDIT_LOGS]';
        const protectedTables = [...linkedTables].filter(name => name.toLowerCase() !== auditTable.toLowerCase());
        if (protectedTables.length) {
            // Keep the PERSON row and all case references intact. Revoke credentials
            // and remove contact information without erasing case identity/history.
            const disabledHash = await bcrypt.hash(crypto.randomBytes(48).toString('hex'), 12);
            const closedEmail = `closed-${personId}-${crypto.randomBytes(8).toString('hex')}@invalid.example`;
            await new sql.Request(transaction)
                .input('personId', sql.Int, personId)
                .input('hash', sql.VarChar(255), disabledHash)
                .input('email', sql.VarChar(254), closedEmail)
                .query(`UPDATE dbo.PERSON
                        SET PasswordHash = @hash, Email = @email,
                            Phone = NULL, ProfessionalRegNo = NULL,
                            Status = 'Inactive'
                        WHERE PersonID = @personId`);
            await transaction.commit(); transaction = null;
            return req.session.destroy(error => {
                if (error) console.error('Account closure session cleanup:', error);
                res.clearCookie('fostercare.sid');
                return res.json({ success: true, outcome: 'closed',
                    message: 'Your account has been closed. Protected case records have been retained.' });
            });
        }

        if (linkedTables.has(auditTable)) {
            // Preserve the audit events but remove their direct association with the deleted login.
            // Never change the database schema or remove audit events automatically.
            const auditColumn = await new sql.Request(transaction).query(`
                SELECT c.is_nullable AS IsNullable
                FROM sys.columns c
                WHERE c.object_id = OBJECT_ID('dbo.AUDIT_LOGS') AND c.name = 'PersonID'
            `);
            if (!auditColumn.recordset.length || !auditColumn.recordset[0].IsNullable) {
                await transaction.rollback(); transaction = null;
                return res.status(409).json({
                    error: 'Audit records must be reviewed before this account can be deleted because AUDIT_LOGS.PersonID does not allow NULL.'
                });
            }
            await new sql.Request(transaction)
                .input('personId', sql.Int, personId)
                .query('UPDATE dbo.AUDIT_LOGS SET PersonID = NULL WHERE PersonID = @personId');
        }

        const deleted = await new sql.Request(transaction)
            .input('personId', sql.Int, personId)
            .query('DELETE FROM dbo.PERSON WHERE PersonID = @personId');
        if (deleted.rowsAffected[0] !== 1) throw new Error('Account deletion affected an unexpected number of rows.');
        await transaction.commit(); transaction = null;
        req.session.destroy(error => {
            if (error) console.error('Post-deletion session cleanup error:', error);
            res.clearCookie('fostercare.sid');
            return res.json({ success: true, outcome: 'deleted', message: 'Your account has been permanently deleted.' });
        });
    } catch (error) {
        if (transaction) try { await transaction.rollback(); } catch (rollbackError) {
            console.error('Account deletion rollback error:', rollbackError);
        }
        console.error('Self-service account deletion error:', error);
        if (error.number === 547) {
            return res.status(409).json({ error: 'This account has related records that must be reviewed by the agency. No account was deleted.' });
        }
        return res.status(500).json({ error: 'Account deletion failed. No account was deleted.' });
    }
});

/* ==========================================================
   START SERVER
   ========================================================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('==========================================');
    console.log('FosterCare Connect server is running');
    console.log(`Server: http://localhost:${PORT}`);
    console.log('==========================================');
});
    