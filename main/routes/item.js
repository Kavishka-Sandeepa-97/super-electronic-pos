const express = require('express');
const router = express.Router();
const { getDatabase, getCurrentUTCTimestamp } = require('../database/init');

// Get all items with category info
router.get('/', (req, res) => {
  const db = getDatabase();
  db.all(
    `SELECT i.*, c.name as category_name 
     FROM item i 
     JOIN category c ON i.category_id = c.id 
     ORDER BY c.name, i.name`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

// Get item by ID with variants
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;

  // Get item details
  db.get(
    `SELECT i.*, c.name as category_name 
     FROM item i 
     JOIN category c ON i.category_id = c.id 
     WHERE i.id = ?`,
    [id],
    (err, item) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }

      // Get item variants
      db.all(
        `SELECT iv.*, v.variant_name, 
                COALESCE(SUM(sb.remaining_qty), 0) as total_stock,
                sph.selling_price
         FROM item_variant iv
         JOIN variant v ON iv.variant_id = v.id
         LEFT JOIN stock_batch sb ON iv.id = sb.item_variant_id
         LEFT JOIN sell_price_history sph ON iv.id = sph.item_variant_id
         WHERE iv.item_id = ?
         GROUP BY iv.id
         ORDER BY v.variant_name`,
        [id],
        (err, variants) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          res.json({
            ...item,
            variants: variants
          });
        }
      );
    }
  );
});

// Create new item
router.post('/', (req, res) => {
  const db = getDatabase();
  const { category_id, name, image } = req.body;

  if (!category_id || !name) {
    return res.status(400).json({ error: 'Category ID and name are required' });
  }

  // Check if category exists
  db.get('SELECT id FROM category WHERE id = ?', [category_id], (err, category) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    db.run(
      'INSERT INTO item (category_id, name, image, created_at) VALUES (?, ?, ?, ?)',
      [category_id, name, image, getCurrentUTCTimestamp()],
      function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json({
          id: this.lastID,
          category_id,
          name,
          image,
          message: 'Item created successfully'
        });
      }
    );
  });
});

// Update item
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { category_id, name, image } = req.body;

  let updateFields = [];
  let values = [];

  if (category_id) {
    updateFields.push('category_id = ?');
    values.push(category_id);
  }
  if (name) {
    updateFields.push('name = ?');
    values.push(name);
  }
  if (image !== undefined) {
    updateFields.push('image = ?');
    values.push(image);
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  values.push(id);

  db.run(
    `UPDATE item SET ${updateFields.join(', ')} WHERE id = ?`,
    values,
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Item not found' });
      }
      res.json({ message: 'Item updated successfully' });
    }
  );
});

// Delete item
router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;

  // Check if item has variants
  db.get('SELECT COUNT(*) as count FROM item_variant WHERE item_id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (row.count > 0) {
      return res.status(409).json({
        error: 'Cannot delete item with existing variants. Please delete variants first.'
      });
    }

    db.run('DELETE FROM item WHERE id = ?', [id], function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Item not found' });
      }
      res.json({ message: 'Item deleted successfully' });
    });
  });
});

// Search items
router.get('/search/:query', (req, res) => {
  const db = getDatabase();
  const { query } = req.params;

  db.all(
    `SELECT i.*, c.name as category_name 
     FROM item i 
     JOIN category c ON i.category_id = c.id 
     WHERE i.name LIKE ? OR c.name LIKE ?
     ORDER BY i.name`,
    [`%${query}%`, `%${query}%`],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

module.exports = router;