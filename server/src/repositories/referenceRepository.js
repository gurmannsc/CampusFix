// Read access to reference data: categories, locations and deadline rules.
import { pool } from '../db.js';
import { Category, DeadlineRule } from '../domain/index.js';

export const categoryRepository = {
  async findById(categoryId) {
    const [rows] = await pool.query('SELECT * FROM categories WHERE category_id = ?', [categoryId]);
    return rows[0] ? toCategory(rows[0]) : null;
  },
  async findAll() {
    const [rows] = await pool.query('SELECT * FROM categories ORDER BY type, name');
    return rows.map(toCategory);
  },
};

export const locationRepository = {
  async exists(locationId) {
    const [rows] = await pool.query('SELECT 1 FROM locations WHERE location_id = ?', [locationId]);
    return rows.length > 0;
  },
  async findAll() {
    const [rows] = await pool.query('SELECT * FROM locations ORDER BY block, floor, room');
    return rows.map((r) => ({ locationId: r.location_id, block: r.block, floor: r.floor, room: r.room, areaType: r.area_type }));
  },
};

export const deadlineRuleRepository = {
  async findByPriority(priority) {
    const [rows] = await pool.query('SELECT * FROM deadline_rules WHERE priority = ?', [priority]);
    return rows[0] ? toRule(rows[0]) : null;
  },
};

const toCategory = (r) => new Category({ categoryId: r.category_id, name: r.name, type: r.type, defaultPriority: r.default_priority });
const toRule = (r) => new DeadlineRule({
  priority: r.priority, resolutionHours: r.resolution_hours, escalationIntervalHours: r.escalation_interval_hours,
});
