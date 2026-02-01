const express = require('express');
const router = express.Router();
const { getDatabase, getCurrentUTCTimestamp } = require('../database/init');

// Get all cashier shifts
router.get('/', (req, res) => {
  const db = getDatabase();
  db.all(`
    SELECT cs.*, s.name as user_name, s.username as user_username
    FROM cashier_shift cs
    JOIN staff s ON cs.user_id = s.id
    ORDER BY cs.open_at DESC
  `, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Get cashier shift by ID
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;

  db.get(`
    SELECT cs.*, s.name as user_name, s.username as user_username
    FROM cashier_shift cs
    JOIN staff s ON cs.user_id = s.id
    WHERE cs.id = ?
  `, [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Cashier shift not found' });
    }
    res.json(row);
  });
});

// Get active (open) shifts
router.get('/status/open', (req, res) => {
  const db = getDatabase();
  db.all(`
    SELECT cs.*, s.name as user_name, s.username as user_username
    FROM cashier_shift cs
    JOIN staff s ON cs.user_id = s.id
    WHERE cs.status = 'open'
    ORDER BY cs.open_at DESC
  `, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Create new cashier shift (open shift)
router.post('/', (req, res) => {
  const db = getDatabase();
  const { user_id, initial_cash_onhand, description } = req.body;

  if (!user_id) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  // Check if user exists
  db.get('SELECT id FROM staff WHERE id = ?', [user_id], (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user already has an open shift
    db.get('SELECT id FROM cashier_shift WHERE user_id = ? AND status = "open"', [user_id], (err, existingShift) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (existingShift) {
        return res.status(400).json({ error: 'User already has an open shift' });
      }

      // Create new shift
      const sql = `
        INSERT INTO cashier_shift (user_id, open_at, initial_cash_onhand, current_cash_onhand, description, status)
        VALUES (?, ?, ?, ?, ?, 'open')
      `;
      const params = [user_id, getCurrentUTCTimestamp(), initial_cash_onhand || 0, initial_cash_onhand || 0, description || ''];

      db.run(sql, params, function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json({
          id: this.lastID,
          message: 'Cashier shift opened successfully'
        });
      });
    });
  });
});

// Close cashier shift
router.put('/:id/close', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { current_cash_onhand, description } = req.body;

  if (current_cash_onhand === undefined) {
    return res.status(400).json({ error: 'Current cash on hand is required' });
  }

  // Check if shift exists and is open
  db.get('SELECT * FROM cashier_shift WHERE id = ? AND status = "open"', [id], (err, shift) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!shift) {
      return res.status(404).json({ error: 'Open cashier shift not found' });
    }

    // Close the shift
    const sql = `
      UPDATE cashier_shift
      SET current_cash_onhand = ?, close_at = ?, description = ?, status = 'closed'
      WHERE id = ?
    `;
    const params = [current_cash_onhand, getCurrentUTCTimestamp(), description || shift.description || '', id];

    db.run(sql, params, function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Cashier shift not found' });
      }
      res.json({
        message: 'Cashier shift closed successfully',
        cash_difference: current_cash_onhand - shift.initial_cash_onhand
      });
    });
  });
});

// Update cashier shift
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { current_cash_onhand, description } = req.body;

  const sql = `
    UPDATE cashier_shift
    SET current_cash_onhand = ?, description = ?
    WHERE id = ? AND status = 'open'
  `;
  const params = [current_cash_onhand, description, id];

  db.run(sql, params, function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Open cashier shift not found' });
    }
    res.json({ message: 'Cashier shift updated successfully' });
  });
});

// Delete cashier shift
router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;

  db.run('DELETE FROM cashier_shift WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Cashier shift not found' });
    }
    res.json({ message: 'Cashier shift deleted successfully' });
  });
});

module.exports = router;