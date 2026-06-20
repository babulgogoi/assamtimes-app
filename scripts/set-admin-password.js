// One-off CLI bootstrap: grants admin login to an existing author row.
// Usage: node scripts/set-admin-password.js <username> <password>
require('dotenv').config();
const bcrypt = require('bcryptjs');
const authorsModel = require('../src/models/authors');
const pool = require('../src/config/db');

async function main() {
  const [username, password] = process.argv.slice(2);

  if (!username || !password) {
    console.error('Usage: node scripts/set-admin-password.js <username> <password>');
    process.exitCode = 1;
    return;
  }

  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exitCode = 1;
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const updated = await authorsModel.setPassword(username, passwordHash);

  if (!updated) {
    console.error(`No author found with username "${username}". Create the author first.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Admin login enabled for "${updated.username}" (author id ${updated.id}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
