const express = require('express');
const router = express.Router();
const { getDatabase, getCurrentUTCTimestamp } = require('../database/init');

// Get all variants
router.get('/', (req, res) => {
  const db = getDatabase();
  db.all('SELECT * FROM variant ORDER BY variant_name', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Get variant by ID
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  db.get('SELECT * FROM variant WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Variant not found' });
    }
    res.json(row);
  });
});

// Create new variant
router.post('/', (req, res) => {
  const db = getDatabase();
  const { variant_name } = req.body;
  
  if (!variant_name) {
    return res.status(400).json({ error: 'Variant name is required' });
  }
  
  db.run(
    'INSERT INTO variant (variant_name, created_at) VALUES (?, ?)',
    [variant_name, getCurrentUTCTimestamp()],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({
        id: this.lastID,
        variant_name,
        message: 'Variant created successfully'
      });
    }
  );
});

// Update variant
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { variant_name } = req.body;
  
  if (!variant_name) {
    return res.status(400).json({ error: 'Variant name is required' });
  }
  
  db.run(
    'UPDATE variant SET variant_name = ? WHERE id = ?',
    [variant_name, id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Variant not found' });
      }
      res.json({ message: 'Variant updated successfully' });
    }
  );
});

// Delete variant
router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  // Check if variant is used in item_variant
  db.get('SELECT COUNT(*) as count FROM item_variant WHERE variant_id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (row.count > 0) {
      return res.status(409).json({ 
        error: 'Cannot delete variant that is being used by items. Please remove item variants first.' 
      });
    }
    
    db.run('DELETE FROM variant WHERE id = ?', [id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Variant not found' });
      }
      res.json({ message: 'Variant deleted successfully' });
    });
  });
});

module.exports = router;