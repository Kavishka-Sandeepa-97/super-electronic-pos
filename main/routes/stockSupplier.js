const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/init');

// Get all suppliers
router.get('/', (req, res) => {
  const db = getDatabase();
  db.all('SELECT * FROM stock_supplier ORDER BY name', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Get supplier by ID
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  db.get('SELECT * FROM stock_supplier WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Supplier not found' });
    }
    res.json(row);
  });
});

// Create new supplier
router.post('/', (req, res) => {
  const db = getDatabase();
  const { name, description } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Supplier name is required' });
  }
  
  db.run(
    'INSERT INTO stock_supplier (name, description) VALUES (?, ?)',
    [name, description || null],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({
        id: this.lastID,
        name,
        description,
        message: 'Supplier created successfully'
      });
    }
  );
});

// Update supplier
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { name, description } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Supplier name is required' });
  }
  
  db.run(
    'UPDATE stock_supplier SET name = ?, description = ? WHERE id = ?',
    [name, description || null, id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Supplier not found' });
      }
      res.json({ message: 'Supplier updated successfully' });
    }
  );
});

// Delete supplier
router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  db.run('DELETE FROM stock_supplier WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }
    res.json({ message: 'Supplier deleted successfully' });
  });
});

module.exports = router;
