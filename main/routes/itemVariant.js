const express = require('express');
const router = express.Router();
const { getDatabase, getCurrentUTCTimestamp } = require('../database/init');

// Get all item variants with details
router.get('/', (req, res) => {
  const db = getDatabase();
  db.all(
    `SELECT iv.*, i.name as item_name, i.image, v.variant_name, c.name as category_name,
            COALESCE(SUM(sb.remaining_qty), 0) as total_stock,
            sph.selling_price,
            sph.selling_price,
            i.id as item_id_ref
     FROM item i
     LEFT JOIN item_variant iv ON i.id = iv.item_id
     LEFT JOIN variant v ON iv.variant_id = v.id
     JOIN category c ON i.category_id = c.id
     LEFT JOIN stock_batch sb ON iv.id = sb.item_variant_id
     LEFT JOIN (
       SELECT item_variant_id, selling_price,
              ROW_NUMBER() OVER (PARTITION BY item_variant_id ORDER BY id DESC) as rn
       FROM sell_price_history
     ) sph ON iv.id = sph.item_variant_id AND sph.rn = 1
     GROUP BY i.id, iv.id
     ORDER BY i.name, v.variant_name`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

// Get item variant by ID
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;

  db.get(
    `SELECT iv.*, i.name as item_name, i.image, v.variant_name, c.name as category_name,
            COALESCE(SUM(sb.remaining_qty), 0) as total_stock,
            sph.selling_price
     FROM item_variant iv
     JOIN item i ON iv.item_id = i.id
     JOIN variant v ON iv.variant_id = v.id
     JOIN category c ON i.category_id = c.id
     LEFT JOIN stock_batch sb ON iv.id = sb.item_variant_id
     LEFT JOIN (
       SELECT item_variant_id, selling_price,
              ROW_NUMBER() OVER (PARTITION BY item_variant_id ORDER BY id DESC) as rn
       FROM sell_price_history
     ) sph ON iv.id = sph.item_variant_id AND sph.rn = 1
     WHERE iv.id = ?
     GROUP BY iv.id`,
    [id],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Item variant not found' });
      }
      res.json(row);
    }
  );
});

// Create new item variant (optionally set initial selling price)
router.post('/', (req, res) => {
  const db = getDatabase();
  const { variant_id, item_id, barcode, selling_price, staff_id } = req.body;

  if (!variant_id || !item_id) {
    return res.status(400).json({ error: 'Variant ID and Item ID are required' });
  }

  // Check if variant and item exist
  db.get('SELECT id FROM variant WHERE id = ?', [variant_id], (err, variant) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!variant) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    db.get('SELECT id FROM item WHERE id = ?', [item_id], (err, item) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }

      db.run(
        'INSERT INTO item_variant (variant_id, item_id, barcode, created_at) VALUES (?, ?, ?, ?)',
        [variant_id, item_id, barcode, getCurrentUTCTimestamp()],
        function (err) {
          if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
              return res.status(409).json({ error: 'Barcode already exists' });
            }
            return res.status(500).json({ error: err.message });
          }

          const newVariantId = this.lastID;

          // If an initial selling price was provided, insert into sell_price_history
          if (selling_price !== undefined && selling_price !== null && selling_price !== '') {
            // Use provided staff_id or fall back to admin (1)
            const uid = staff_id || 1;
            db.run(
              'INSERT INTO sell_price_history (item_variant_id, staff_id, selling_price, created_at) VALUES (?, ?, ?, ?)',
              [newVariantId, uid, selling_price, getCurrentUTCTimestamp()],
              function (err2) {
                if (err2) {
                  // Log error but still return created item variant
                  console.error('Failed to insert initial selling price:', err2);
                  return res.status(201).json({
                    id: newVariantId,
                    variant_id,
                    item_id,
                    barcode,
                    message: 'Item variant created successfully (price not saved)'
                  });
                }

                return res.status(201).json({
                  id: newVariantId,
                  variant_id,
                  item_id,
                  barcode,
                  selling_price,
                  message: 'Item variant created successfully with initial selling price'
                });
              }
            );
          } else {
            return res.status(201).json({
              id: newVariantId,
              variant_id,
              item_id,
              barcode,
              message: 'Item variant created successfully'
            });
          }
        }
      );
    });
  });
});

// Update item variant
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { variant_id, item_id, barcode } = req.body;

  let updateFields = [];
  let values = [];

  if (variant_id) {
    updateFields.push('variant_id = ?');
    values.push(variant_id);
  }
  if (item_id) {
    updateFields.push('item_id = ?');
    values.push(item_id);
  }
  if (barcode !== undefined) {
    updateFields.push('barcode = ?');
    values.push(barcode);
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  values.push(id);

  db.run(
    `UPDATE item_variant SET ${updateFields.join(', ')} WHERE id = ?`,
    values,
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'Barcode already exists' });
        }
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Item variant not found' });
      }
      res.json({ message: 'Item variant updated successfully' });
    }
  );
});

// Delete item variant
router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;

  // Check if item variant has stock or orders
  db.get('SELECT COUNT(*) as stock_count FROM stock_batch WHERE item_variant_id = ?', [id], (err, stockRow) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    db.get('SELECT COUNT(*) as order_count FROM item_variant_order WHERE item_variant_id = ?', [id], (err, orderRow) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (stockRow.stock_count > 0 || orderRow.order_count > 0) {
        return res.status(409).json({
          error: 'Cannot delete item variant with existing stock or orders.'
        });
      }

      db.run('DELETE FROM item_variant WHERE id = ?', [id], function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Item variant not found' });
        }
        res.json({ message: 'Item variant deleted successfully' });
      });
    });
  });
});

// Search item variants by barcode
router.get('/barcode/:barcode', (req, res) => {
  const db = getDatabase();
  const { barcode } = req.params;

  db.get(
    `SELECT iv.*, i.name as item_name, i.image, v.variant_name, c.name as category_name
     FROM item_variant iv
     JOIN item i ON iv.item_id = i.id
     JOIN variant v ON iv.variant_id = v.id
     JOIN category c ON i.category_id = c.id
     WHERE iv.barcode = ?`,
    [barcode],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Item variant not found' });
      }

      // Get stock separately
      db.get(
        `SELECT COALESCE(SUM(remaining_qty), 0) as total_stock
         FROM stock_batch
         WHERE item_variant_id = ?`,
        [row.id],
        (stockErr, stockRow) => {
          if (stockErr) {
            console.error('Stock query error:', stockErr);
            return res.status(500).json({ error: stockErr.message });
          }

          // Get selling price separately
          db.get(
            `SELECT selling_price
             FROM sell_price_history
             WHERE item_variant_id = ?
             ORDER BY id DESC
             LIMIT 1`,
            [row.id],
            (priceErr, priceRow) => {
              if (priceErr) {
                console.error('Price query error:', priceErr);
                return res.status(500).json({ error: priceErr.message });
              }

              // Combine all data
              const result = {
                ...row,
                total_stock: stockRow?.total_stock || 0,
                selling_price: priceRow?.selling_price || 0
              };

              res.json(result);
            }
          );
        }
      );
    }
  );
});

// Set selling price for item variant
router.post('/:id/price', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { selling_price, staff_id, stock_batch_id } = req.body;

  if (!selling_price || !staff_id) {
    return res.status(400).json({ error: 'Selling price and staff ID are required' });
  }

  db.run(
    'INSERT INTO sell_price_history (item_variant_id, staff_id, selling_price, stock_batch_id, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, staff_id, selling_price, stock_batch_id, getCurrentUTCTimestamp()],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({
        id: this.lastID,
        item_variant_id: id,
        selling_price,
        message: 'Price set successfully'
      });
    }
  );
});

module.exports = router;