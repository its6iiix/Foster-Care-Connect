/* ==========================================================
   seed-users.js
   Run this ONCE after schema.sql, to create real login
   accounts (one per role) so you can actually log in and
   test each dashboard. Passwords are hashed with bcrypt --
   never stored as plain text.

   HOW TO RUN:
   1) npm install bcrypt   (in your project folder, in a terminal)
   2) node seed-users.js
   ========================================================== */

const sql = require('mssql');
const bcrypt = require('bcrypt');

const dbConfig = {
    server: 'localhost',
    port: 1433,
    database: 'FOSTERCARE',
    user: 'sa',
    password: 'AdminPass123!',
    options: {
        enableArithAbort: true,
        trustServerCertificate: true,
        encrypt: false,
        connectTimeout: 30000
    }
};

// Edit this list to add/remove test accounts. RoleID must match
// the RoleID that schema.sql inserted into the ROLES table
// (1=Admin, 2=Social Worker, 3=Foster Parent, 4=Biological Parent,
//  5=Agency Manager, 6=Clerk).
const usersToCreate = [
    { fullName: 'Site Administrator', email: 'admin@fostercare.test',     password: 'Admin123!',   roleId: 1 },
    { fullName: 'Naledi Khumalo',     email: 'socialworker@fostercare.test', password: 'Worker123!', roleId: 2 },
    { fullName: 'Thabo Mokoena',      email: 'fosterparent@fostercare.test', password: 'Parent123!', roleId: 3 },
    { fullName: 'Lindiwe Dlamini',    email: 'bioparent@fostercare.test',    password: 'Parent123!', roleId: 4 },
    { fullName: 'Sipho Nkosi',        email: 'manager@fostercare.test',      password: 'Manager123!',roleId: 5 },
    { fullName: 'Anele Botha',        email: 'clerk@fostercare.test',        password: 'Clerk123!',  roleId: 6 },
];

async function seed() {
    try {
        const pool = await sql.connect(dbConfig);

        for (const u of usersToCreate) {
            const existing = await pool.request()
                .input('email', sql.VarChar, u.email)
                .query('SELECT PersonID FROM PERSON WHERE Email = @email');

            if (existing.recordset.length > 0) {
                console.log(`Skipped (already exists): ${u.email}`);
                continue;
            }

            const passwordHash = await bcrypt.hash(u.password, 10);

            await pool.request()
                .input('fullName', sql.VarChar, u.fullName)
                .input('email', sql.VarChar, u.email)
                .input('passwordHash', sql.VarChar, passwordHash)
                .input('roleId', sql.Int, u.roleId)
                .query(`INSERT INTO PERSON (FullName, Email, PasswordHash, RoleID, Status)
                        VALUES (@fullName, @email, @passwordHash, @roleId, 'Active')`);

            console.log(`Created: ${u.email} / ${u.password}`);
        }

        console.log('\nDone. Use these email/password pairs on your login page.');
        await pool.close();
    } catch (err) {
        console.error('Seeding failed:', err.message);
    }
}

seed();


