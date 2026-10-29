/* ==========================================================
   reset-password.js
   Resets one account's password directly in the database.
   Use this if login keeps failing with "Invalid email or
   password" even though you're sure you're typing it right.

   HOW TO RUN (from your project folder terminal):
   node reset-password.js socialworker@fostercare.test Worker123!

   You can run it for any of your 6 test accounts the same way.
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

async function resetPassword() {
    const email = process.argv[2];
    const newPassword = process.argv[3];

    if (!email || !newPassword) {
        console.log('Usage: node reset-password.js <email> <newPassword>');
        return;
    }

    try {
        const pool = await sql.connect(dbConfig);

        const existing = await pool.request()
            .input('email', sql.VarChar, email)
            .query('SELECT PersonID FROM PERSON WHERE Email = @email');

        if (existing.recordset.length === 0) {
            console.log(`No account found with email: ${email}`);
            return;
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);

        await pool.request()
            .input('email', sql.VarChar, email)
            .input('passwordHash', sql.VarChar, passwordHash)
            .query('UPDATE PERSON SET PasswordHash = @passwordHash WHERE Email = @email');

        console.log(`Password reset for ${email}. New password: ${newPassword}`);
        await pool.close();
    } catch (err) {
        console.error('Reset failed:', err.message);
    }
}

resetPassword();


