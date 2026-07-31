const pool = require('../config/db');

async function create(rating) {
  await pool.query(`INSERT INTO site_ratings (rating) VALUES ($1)`, [rating]);
  return getAggregate();
}

async function getAggregate() {
  const { rows } = await pool.query(`SELECT AVG(rating)::float AS average, COUNT(*) AS count FROM site_ratings`);
  return {
    average: rows[0].average ? Number(rows[0].average) : 0,
    count: Number(rows[0].count),
  };
}

module.exports = { create, getAggregate };
