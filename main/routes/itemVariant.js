const express = require('express');
const router = express.Router();
const { getDatabase, getCurrentUTCTimestamp } = require('../database/init');

// Get all item variants with details
router.get('/', (req, res) => {
  const db = getDatabase();
  try {
    const rows = db.prepare(`
      SELECT iv.*, i.name as item_name, i.image, v.variant_name, c.name as category_name,
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
      ORDER BY i.name, v.variant_name
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get item variant by ID
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;

  try {
    const row = db.prepare(`
      SELECT iv.*, i.name as item_name, i.image, v.variant_name, c.name as category_name,
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
      GROUP BY iv.id
    `).get(id);

    if (!row) {
      return res.status(404).json({ error: 'Item variant not found' });
    }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new item variant (optionally set initial selling price)
router.post('/', (req, res) => {
  const db = getDatabase();
  const { variant_id, item_id, barcode, selling_price, staff_id } = req.body;

  if (!variant_id || !item_id) {
    return res.status(400).json({ error: 'Variant ID and Item ID are required' });
  }

  try {
    // Check if variant exists
    const variant = db.prepare('SELECT id FROM variant WHERE id = ?').get(variant_id);
    if (!variant) {
      return res.status(404).json({ error: 'Variant not found' });
    }

    // Check if item exists
    const item = db.prepare('SELECT id FROM item WHERE id = ?').get(item_id);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const result = db.prepare('INSERT INTO item_variant (variant_id, item_id, barcode, created_at) VALUES (?, ?, ?, ?)').run(variant_id, item_id, barcode, getCurrentUTCTimestamp());
    const newVariantId = result.lastInsertRowid;

    // If an initial selling price was provided, insert into sell_price_history
    if (selling_price !== undefined && selling_price !== null && selling_price !== '') {
      const uid = staff_id || 1;
      try {
        db.prepare('INSERT INTO sell_price_history (item_variant_id, staff_id, selling_price, created_at) VALUES (?, ?, ?, ?)').run(newVariantId, uid, selling_price, getCurrentUTCTimestamp());
        return res.status(201).json({
          id: newVariantId,
          variant_id,
          item_id,
          barcode,
          selling_price,
          message: 'Item variant created successfully with initial selling price'
        });
      } catch (err2) {
        console.error('Failed to insert initial selling price:', err2);
        return res.status(201).json({
          id: newVariantId,
          variant_id,
          item_id,
          barcode,
          message: 'Item variant created successfully (price not saved)'
        });
      }
    }

    res.status(201).json({
      id: newVariantId,
      variant_id,
      item_id,
      barcode,
      message: 'Item variant created successfully'
    });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Barcode already exists' });
    }
    res.status(500).json({ error: err.message });
  }
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

  try {
    const result = db.prepare(`UPDATE item_variant SET ${updateFields.join(', ')} WHERE id = ?`).run(...values);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Item variant not found' });
    }
    res.json({ message: 'Item variant updated successfully' });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Barcode already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Delete item variant
router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;

  try {
    // Check if item variant has stock or orders
    const stockRow = db.prepare('SELECT COUNT(*) as stock_count FROM stock_batch WHERE item_variant_id = ?').get(id);
    const orderRow = db.prepare('SELECT COUNT(*) as order_count FROM item_variant_order WHERE item_variant_id = ?').get(id);

    if (stockRow.stock_count > 0 || orderRow.order_count > 0) {
      return res.status(409).json({
        error: 'Cannot delete item variant with existing stock or orders.'
      });
    }

    const result = db.prepare('DELETE FROM item_variant WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Item variant not found' });
    }
    res.json({ message: 'Item variant deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search item variants by barcode
router.get('/barcode/:barcode', (req, res) => {
  const db = getDatabase();
  const { barcode } = req.params;

  try {
    const row = db.prepare(`
      SELECT iv.*, i.name as item_name, i.image, v.variant_name, c.name as category_name
      FROM item_variant iv
      JOIN item i ON iv.item_id = i.id
      JOIN variant v ON iv.variant_id = v.id
      JOIN category c ON i.category_id = c.id
      WHERE iv.barcode = ?
    `).get(barcode);

    if (!row) {
      return res.status(404).json({ error: 'Item variant not found' });
    }

    // Get stock separately
    const stockRow = db.prepare(`
      SELECT COALESCE(SUM(remaining_qty), 0) as total_stock
      FROM stock_batch
      WHERE item_variant_id = ?
    `).get(row.id);

    // Get selling price separately
    const priceRow = db.prepare(`
      SELECT selling_price
      FROM sell_price_history
      WHERE item_variant_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(row.id);

    // Combine all data
    const result = {
      ...row,
      total_stock: stockRow?.total_stock || 0,
      selling_price: priceRow?.selling_price || 0
    };

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set selling price for item variant
router.post('/:id/price', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { selling_price, staff_id, stock_batch_id } = req.body;

  if (!selling_price || !staff_id) {
    return res.status(400).json({ error: 'Selling price and staff ID are required' });
  }

  try {
    const result = db.prepare('INSERT INTO sell_price_history (item_variant_id, staff_id, selling_price, stock_batch_id, created_at) VALUES (?, ?, ?, ?, ?)').run(id, staff_id, selling_price, stock_batch_id, getCurrentUTCTimestamp());
    res.status(201).json({
      id: result.lastInsertRowid,
      item_variant_id: id,
      selling_price,
      message: 'Price set successfully'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;