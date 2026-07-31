// One-time extraction of D7 `users` rows from the MySQL dump into the
// d7_newsletter_staging table. Reads the dump as a stream (it's ~758MB), grabs
// the single `INSERT INTO \`users\` VALUES ...;` statement, and parses each
// tuple with a quote-aware scanner — a naive comma split would break on the
// `data` longblob column, which holds serialized PHP (commas, colons, escaped
// quotes) inline.
//
// D7 users column order (verified against the dump's CREATE TABLE):
//   0 uid, 1 name, 2 pass, 3 mail, 4 theme, 5 signature, 6 signature_format,
//   7 created, 8 access, 9 login, 10 status, 11 timezone, 12 language,
//   13 picture, 14 init, 15 data, 16 changed
//
// Usage: node scripts/028_extract_d7_users.js
require('dotenv').config();

const fs = require('fs');
const readline = require('readline');
const pool = require('../src/config/db');

const DUMP_PATH = '/home/assam1/web/assamtimes.org/private/migration/db.txt';
const INSERT_MARKER = 'INSERT INTO `users` VALUES';

// Parses a MySQL extended-INSERT value list "(...),(...),...;" into an array of
// tuples, each tuple an array of JS values (string | number | null). Respects
// single-quoted strings with backslash escapes so commas/quotes inside the
// serialized `data` blob don't split a field.
function parseTuples(buf) {
  const tuples = [];
  let i = 0;
  const n = buf.length;

  while (i < n) {
    // Advance to the next tuple opener.
    while (i < n && buf[i] !== '(') i++;
    if (i >= n) break;
    i++; // consume '('

    const fields = [];
    let field = '';
    let wasString = false; // did the current field originate as a quoted string?
    let inString = false;

    while (i < n) {
      const ch = buf[i];

      if (inString) {
        if (ch === '\\') {
          // MySQL backslash escape — decode the common ones, keep the rest verbatim.
          const next = buf[i + 1];
          const map = { n: '\n', r: '\r', t: '\t', '0': '\0' };
          field += Object.prototype.hasOwnProperty.call(map, next) ? map[next] : next;
          i += 2;
          continue;
        }
        if (ch === "'") { inString = false; i++; continue; }
        field += ch;
        i++;
        continue;
      }

      if (ch === "'") { inString = true; wasString = true; i++; continue; }
      if (ch === ',') {
        fields.push(finalizeField(field, wasString));
        field = '';
        wasString = false;
        i++;
        continue;
      }
      if (ch === ')') {
        fields.push(finalizeField(field, wasString));
        i++;
        tuples.push(fields);
        break;
      }
      field += ch;
      i++;
    }
  }

  return tuples;
}

// A field that was a quoted string stays a string; a bare NULL becomes null;
// anything else (an integer) is returned as-is (string form is fine, callers
// coerce what they need).
function finalizeField(raw, wasString) {
  if (wasString) return raw;
  const trimmed = raw.trim();
  if (trimmed === 'NULL' || trimmed === '') return trimmed === 'NULL' ? null : '';
  return trimmed;
}

function isValidEmail(email) {
  if (!email) return false;
  const at = email.indexOf('@');
  if (at <= 0) return false;
  const dot = email.indexOf('.', at + 1);
  return dot > at + 1 && dot < email.length - 1;
}

async function main() {
  const stream = fs.createReadStream(DUMP_PATH, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let capturing = false;
  let buffer = '';

  // Read only the users INSERT statement, then stop reading the 758MB file.
  for await (const line of rl) {
    if (!capturing) {
      if (line.startsWith(INSERT_MARKER)) {
        capturing = true;
        buffer += line.slice(INSERT_MARKER.length);
        if (line.trimEnd().endsWith(';')) break;
      }
      continue;
    }
    buffer += '\n' + line;
    if (line.trimEnd().endsWith(';')) break;
  }
  rl.close();
  stream.destroy();

  if (!buffer) {
    console.error('Could not find the users INSERT statement in the dump.');
    process.exitCode = 1;
    return;
  }

  const tuples = parseTuples(buffer);

  let processed = 0;
  let inserted = 0;
  let skippedNoEmail = 0;
  let skippedBlocked = 0;
  let skippedInvalid = 0;
  let alreadyExisted = 0;

  for (const t of tuples) {
    processed++;
    const uid = parseInt(t[0], 10);
    const name = t[1];
    const mail = t[3];
    const status = parseInt(t[10], 10);

    if (uid === 0) { continue; } // anonymous user, not a real subscriber

    if (!mail || String(mail).trim() === '') { skippedNoEmail++; continue; }
    if (status === 0) { skippedBlocked++; continue; }
    if (!isValidEmail(String(mail).trim())) { skippedInvalid++; continue; }

    const email = String(mail).trim().toLowerCase();

    const { rowCount } = await pool.query(
      `INSERT INTO d7_newsletter_staging (uid, username, email, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [uid, name || null, email, status]
    );

    if (rowCount === 1) inserted++;
    else alreadyExisted++;
  }

  console.log('D7 user extraction complete.');
  console.log(`  Total rows processed:      ${processed}`);
  console.log(`  Valid users inserted:      ${inserted}`);
  console.log(`  Skipped (no email):        ${skippedNoEmail}`);
  console.log(`  Skipped (blocked):         ${skippedBlocked}`);
  console.log(`  Skipped (invalid email):   ${skippedInvalid}`);
  console.log(`  Already existed:           ${alreadyExisted}`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('028_extract_d7_users failed:', err);
    pool.end();
    process.exitCode = 1;
  });
