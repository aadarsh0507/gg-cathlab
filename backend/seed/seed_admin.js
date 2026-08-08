require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const pool = require('../db/mysql');

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const argMap = {};
  for (let i = 0; i < args.length; i += 2) {
    argMap[args[i].replace(/^--/, '')] = args[i + 1];
  }

  const username = argMap.username || (await prompt('Admin username: '));
  const password = argMap.password || (await prompt('Admin password: '));
  const fullName = argMap.fullName || argMap.name || (await prompt('Full name: ')) || username;

  if (!username || !password) {
    console.error('Username and password are required.');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      console.error(`User "${username}" already exists.`);
      process.exit(1);
    }

    const [roles] = await pool.query("SELECT id FROM roles WHERE name = 'admin' LIMIT 1");
    if (roles.length === 0) {
      console.error('Admin role not found in the roles table. Run migrations first.');
      process.exit(1);
    }
    const adminRoleId = roles[0].id;

    await pool.query(
      'INSERT INTO users (username, password_hash, full_name, role_id, is_active) VALUES (?, ?, ?, ?, 1)',
      [username, passwordHash, fullName, adminRoleId]
    );

    console.log(`Admin user "${username}" created successfully.`);
  } catch (err) {
    console.error('Failed to create admin user:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
