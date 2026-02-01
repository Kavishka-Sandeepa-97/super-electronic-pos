const express = require('express');
const router = express.Router();
const { getDatabase, getCurrentUTCTimestamp } = require('../database/init');

// Get all stock batches
router.get('/', (req, res) => {
  const db = getDatabase();
  db.all(
    `SELECT sb.*, iv.barcode, i.name as item_name, v.variant_name
     FROM stock_batch sb
     JOIN item_variant iv ON sb.item_variant_id = iv.id
     JOIN item i ON iv.item_id = i.id
     JOIN variant v ON iv.variant_id = v.id
     ORDER BY sb.created_at DESC`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

// Get stock batch by ID
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  db.get(
    `SELECT sb.*, iv.barcode, i.name as item_name, v.variant_name
     FROM stock_batch sb
     JOIN item_variant iv ON sb.item_variant_id = iv.id
     JOIN item i ON iv.item_id = i.id
     JOIN variant v ON iv.variant_id = v.id
     WHERE sb.id = ?`,
    [id],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Stock batch not found' });
      }
      res.json(row);
    }
  );
});

// Create new stock batch (Add inventory)
router.post('/', (req, res) => {
  const db = getDatabase();
  const { item_variant_id, buy_price, initial_qty, description } = req.body;
  
  if (!item_variant_id || !buy_price || !initial_qty) {
    return res.status(400).json({ error: 'Item variant ID, buy price, and initial quantity are required' });
  }
  
  // Check if item variant exists
  db.get('SELECT id FROM item_variant WHERE id = ?', [item_variant_id], (err, itemVariant) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!itemVariant) {
      return res.status(404).json({ error: 'Item variant not found' });
    }
    
    db.run(
      'INSERT INTO stock_batch (item_variant_id, buy_price, initial_qty, remaining_qty, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [item_variant_id, buy_price, initial_qty, initial_qty, description, getCurrentUTCTimestamp()],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json({
          id: this.lastID,
          item_variant_id,
          buy_price,
          initial_qty,
          remaining_qty: initial_qty,
          description,
          message: 'Stock batch created successfully'
        });
      }
    );
  });
});

// Update stock batch
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { buy_price, description, initial_qty, remaining_qty } = req.body;
  
  let updateFields = [];
  let values = [];
  
  if (buy_price) {
    updateFields.push('buy_price = ?');
    values.push(buy_price);
  }
  if (description !== undefined) {
    updateFields.push('description = ?');
    values.push(description);
  }
  if (initial_qty !== undefined) {
    updateFields.push('initial_qty = ?');
    values.push(initial_qty);
  }
  if (remaining_qty !== undefined) {
    updateFields.push('remaining_qty = ?');
    values.push(remaining_qty);
  }
  
  if (updateFields.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }
  
  values.push(id);
  
  db.run(
    `UPDATE stock_batch SET ${updateFields.join(', ')} WHERE id = ?`,
    values,
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Stock batch not found' });
      }
      res.json({ message: 'Stock batch updated successfully' });
    }
  );
});

// Adjust stock quantity
router.put('/:id/adjust', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { adjustment, reason } = req.body;
  
  if (adjustment === undefined) {
    return res.status(400).json({ error: 'Adjustment amount is required' });
  }
  
  db.get('SELECT remaining_qty FROM stock_batch WHERE id = ?', [id], (err, batch) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!batch) {
      return res.status(404).json({ error: 'Stock batch not found' });
    }
    
    const newQty = batch.remaining_qty + adjustment;
    if (newQty < 0) {
      return res.status(400).json({ error: 'Insufficient stock for this adjustment' });
    }
    
    db.run(
      'UPDATE stock_batch SET remaining_qty = ? WHERE id = ?',
      [newQty, id],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json({
          message: 'Stock adjusted successfully',
          previous_qty: batch.remaining_qty,
          adjustment: adjustment,
          new_qty: newQty,
          reason: reason
        });
      }
    );
  });
});

// Get stock summary by item variant
router.get('/summary/by-item', (req, res) => {
  const db = getDatabase();
  
  db.all(
    `SELECT iv.id as item_variant_id, iv.barcode, i.name as item_name, v.variant_name,
            SUM(sb.remaining_qty) as total_stock,
            COUNT(sb.id) as batch_count,
            MIN(sb.buy_price) as min_buy_price,
            MAX(sb.buy_price) as max_buy_price,
            AVG(sb.buy_price) as avg_buy_price
     FROM item_variant iv
     LEFT JOIN stock_batch sb ON iv.id = sb.item_variant_id
     JOIN item i ON iv.item_id = i.id
     JOIN variant v ON iv.variant_id = v.id
     GROUP BY iv.id
     ORDER BY i.name, v.variant_name`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

// Get low stock items
router.get('/alerts/low-stock', (req, res) => {
  const db = getDatabase();
  const { threshold = 10 } = req.query;
  
  db.all(
    `SELECT iv.id as item_variant_id, iv.barcode, i.name as item_name, v.variant_name,
            SUM(sb.remaining_qty) as total_stock
     FROM item_variant iv
     LEFT JOIN stock_batch sb ON iv.id = sb.item_variant_id
     JOIN item i ON iv.item_id = i.id
     JOIN variant v ON iv.variant_id = v.id
     GROUP BY iv.id
     HAVING total_stock <= ?
     ORDER BY total_stock ASC`,
    [threshold],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

// Get stock batches by item variant ID
router.get('/batches/:item_variant_id', (req, res) => {
  const db = getDatabase();
  const { item_variant_id } = req.params;
  
  db.all(
    `SELECT sb.*, iv.barcode, i.name as item_name, v.variant_name
     FROM stock_batch sb
     JOIN item_variant iv ON sb.item_variant_id = iv.id
     JOIN item i ON iv.item_id = i.id
     JOIN variant v ON iv.variant_id = v.id
     WHERE sb.item_variant_id = ?
     ORDER BY sb.created_at ASC`,
    [item_variant_id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

// Get stock movements (for audit trail)
router.get('/movements/:item_variant_id', (req, res) => {
  const db = getDatabase();
  const { item_variant_id } = req.params;
  
  // Get stock additions
  db.all(
    `SELECT 'STOCK_IN' as type, sb.created_at as date, sb.initial_qty as quantity, 
            sb.buy_price as price, sb.description, sb.id as reference_id,
            sb.initial_qty as initial_qty, sb.remaining_qty as current_qty
     FROM stock_batch sb
     WHERE sb.item_variant_id = ?`,
    [item_variant_id],
    (err, stockIns) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      // Get stock sales
      db.all(
        `SELECT 'SALE' as type, o.date, ivo.qty as quantity, 
                ivo.unit_price as price, o.customer_name as description, o.id as reference_id,
                NULL as initial_qty, NULL as current_qty
         FROM item_variant_order ivo
         JOIN orders o ON ivo.order_id = o.id
         WHERE ivo.item_variant_id = ? AND o.status = 'completed'`,
        [item_variant_id],
        (err, sales) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          
          // Combine and sort by date
          const movements = [...stockIns, ...sales].sort((a, b) => new Date(b.date) - new Date(a.date));
          
          // Calculate running totals for stock levels
          let runningTotal = 0;
          const movementsWithTotals = movements.map(movement => {
            if (movement.type === 'STOCK_IN') {
              runningTotal += parseFloat(movement.quantity);
              return {
                ...movement,
                stock_after_transaction: runningTotal
              };
            } else if (movement.type === 'SALE') {
              runningTotal -= parseFloat(movement.quantity);
              return {
                ...movement,
                stock_after_transaction: runningTotal
              };
            }
            return movement;
          });
          
          res.json(movementsWithTotals);
        }
      );
    }
  );
});

module.exports = router;