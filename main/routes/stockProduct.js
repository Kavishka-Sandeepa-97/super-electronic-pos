const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/init');

// Get all products with category and unit info
router.get('/', (req, res) => {
  const db = getDatabase();
  db.all(
    `SELECT 
      sp.*,
      sc.name as category_name,
      u.name as unit_name
    FROM stock_product sp
    LEFT JOIN stock_category sc ON sp.category_id = sc.id
    LEFT JOIN unit u ON sp.unit_id = u.id
    ORDER BY sp.name`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

// Get product by ID
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  db.get(
    `SELECT 
      sp.*,
      sc.name as category_name,
      u.name as unit_name
    FROM stock_product sp
    LEFT JOIN stock_category sc ON sp.category_id = sc.id
    LEFT JOIN unit u ON sp.unit_id = u.id
    WHERE sp.id = ?`,
    [id],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Product not found' });
      }
      res.json(row);
    }
  );
});

// Create new product
router.post('/', (req, res) => {
  const db = getDatabase();
  const { name, category_id, unit_id, current_qty } = req.body;
  
  if (!name || !category_id || !unit_id) {
    return res.status(400).json({ 
      error: 'Product name, category, and unit are required' 
    });
  }
  
  db.run(
    'INSERT INTO stock_product (name, category_id, unit_id, current_qty) VALUES (?, ?, ?, ?)',
    [name, category_id, unit_id, current_qty || 0],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({
        id: this.lastID,
        name,
        category_id,
        unit_id,
        current_qty: current_qty || 0,
        message: 'Product created successfully'
      });
    }
  );
});

// Update product
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { name, category_id, unit_id } = req.body;
  
  if (!name || !category_id || !unit_id) {
    return res.status(400).json({ 
      error: 'Product name, category, and unit are required' 
    });
  }
  
  db.run(
    'UPDATE stock_product SET name = ?, category_id = ?, unit_id = ? WHERE id = ?',
    [name, category_id, unit_id, id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Product not found' });
      }
      res.json({ message: 'Product updated successfully' });
    }
  );
});

// Delete product
router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  // Check if product has transactions
  db.get('SELECT COUNT(*) as count FROM stock_transaction WHERE product_id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (row.count > 0) {
      return res.status(409).json({ 
        error: 'Cannot delete product with existing transactions' 
      });
    }
    
    db.run('DELETE FROM stock_product WHERE id = ?', [id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Product not found' });
      }
      res.json({ message: 'Product deleted successfully' });
    });
  });
});

module.exports = router;
