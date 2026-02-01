const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/init');

// Get all units
router.get('/', (req, res) => {
  const db = getDatabase();
  db.all('SELECT * FROM unit ORDER BY name', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Get unit by ID
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  db.get('SELECT * FROM unit WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Unit not found' });
    }
    res.json(row);
  });
});

// Create new unit
router.post('/', (req, res) => {
  const db = getDatabase();
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Unit name is required' });
  }
  
  db.run(
    'INSERT INTO unit (name) VALUES (?)',
    [name],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'Unit name already exists' });
        }
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({
        id: this.lastID,
        name,
        message: 'Unit created successfully'
      });
    }
  );
});

// Update unit
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Unit name is required' });
  }
  
  db.run(
    'UPDATE unit SET name = ? WHERE id = ?',
    [name, id],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'Unit name already exists' });
        }
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Unit not found' });
      }
      res.json({ message: 'Unit updated successfully' });
    }
  );
});

// Delete unit
router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  // Check if unit is being used by products
  db.get('SELECT COUNT(*) as count FROM stock_product WHERE unit_id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (row.count > 0) {
      return res.status(409).json({ 
        error: 'Cannot delete unit that is being used by products' 
      });
    }
    
    db.run('DELETE FROM unit WHERE id = ?', [id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Unit not found' });
      }
      res.json({ message: 'Unit deleted successfully' });
    });
  });
});

module.exports = router;
