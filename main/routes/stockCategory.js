const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/init');

// Get all stock categories
router.get('/', (req, res) => {
  const db = getDatabase();
  db.all('SELECT * FROM stock_category ORDER BY name', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Get stock category by ID
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  db.get('SELECT * FROM stock_category WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Stock category not found' });
    }
    res.json(row);
  });
});

// Create new stock category
router.post('/', (req, res) => {
  const db = getDatabase();
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Category name is required' });
  }
  
  db.run(
    'INSERT INTO stock_category (name) VALUES (?)',
    [name],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'Category name already exists' });
        }
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({
        id: this.lastID,
        name,
        message: 'Stock category created successfully'
      });
    }
  );
});

// Update stock category
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { name } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Category name is required' });
  }
  
  db.run(
    'UPDATE stock_category SET name = ? WHERE id = ?',
    [name, id],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'Category name already exists' });
        }
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Stock category not found' });
      }
      res.json({ message: 'Stock category updated successfully' });
    }
  );
});

// Delete stock category
router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  // Check if category has products
  db.get('SELECT COUNT(*) as count FROM stock_product WHERE category_id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (row.count > 0) {
      return res.status(409).json({ 
        error: 'Cannot delete category with existing products' 
      });
    }
    
    db.run('DELETE FROM stock_category WHERE id = ?', [id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Stock category not found' });
      }
      res.json({ message: 'Stock category deleted successfully' });
    });
  });
});

module.exports = router;
