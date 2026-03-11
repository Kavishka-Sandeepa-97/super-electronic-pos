const express = require('express');
const router = express.Router();
const { getDatabase, getCurrentUTCTimestamp } = require('../database/init');

// Get all orders
router.get('/', (req, res) => {
  const db = getDatabase();
  const { status, date_from, date_to, page = 1, limit = 10 } = req.query;
  
  try {
    let query = `
      SELECT o.*, CASE WHEN s.name = 'Admin' THEN 'System' ELSE s.name END as staff_name 
      FROM orders o 
      JOIN staff s ON o.staff_id = s.id
    `;
    let params = [];
    let conditions = [];
    
    if (status) {
      conditions.push('o.status = ?');
      params.push(status);
    }
    
    if (date_from) {
      conditions.push('DATE(o.date) >= ?');
      params.push(date_from);
    }
    
    if (date_to) {
      conditions.push('DATE(o.date) <= ?');
      params.push(date_to);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY o.date DESC';
    
    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM orders o';
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }
    
    const countResult = db.prepare(countQuery).get(...params);
    const total = countResult.total;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Add pagination to main query
    const paginatedQuery = query + ' LIMIT ? OFFSET ?';
    const rows = db.prepare(paginatedQuery).all(...params, parseInt(limit), offset);
    
    // Calculate total amount for current result set
    const totalAmount = rows.reduce((sum, order) => sum + parseFloat(order.total_amount || 0), 0);
    
    res.json({
      orders: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        totalPages: Math.ceil(total / parseInt(limit))
      },
      totalAmount: totalAmount
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get order by ID with items
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  try {
    // Get order details
    const order = db.prepare(`
      SELECT o.*, CASE WHEN s.name = 'Admin' THEN 'System' ELSE s.name END as staff_name 
      FROM orders o 
      JOIN staff s ON o.staff_id = s.id 
      WHERE o.id = ?
    `).get(id);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Get order items
    const items = db.prepare(`
      SELECT ivo.*, iv.barcode, i.name as item_name, v.variant_name, c.name as category,
             ivo.discount_source, ivo.discount_type as item_discount_type, 
             ivo.discount_value as item_discount_value, ivo.discount_amount as item_discount_amount,
             ivo.original_price
      FROM item_variant_order ivo
      JOIN item_variant iv ON ivo.item_variant_id = iv.id
      JOIN item i ON iv.item_id = i.id
      JOIN variant v ON iv.variant_id = v.id
      JOIN category c ON i.category_id = c.id
      WHERE ivo.order_id = ?
    `).all(id);
    
    res.json({
      ...order,
      items: items
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new order
router.post('/', (req, res) => {
  const db = getDatabase();
  const { 
    staff_id, 
    additional_charges = 0, 
    customer_name, 
    tender_cash,
    discount_type,
    discount_value = 0,
    status = 'active',
    items 
  } = req.body;
  
  if (!staff_id || !items || items.length === 0) {
    return res.status(400).json({ error: 'Staff ID and items are required' });
  }

  if (!['active', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  // Calculate total amount
  // unit_price is already the discounted price (item/brand/global discounts applied)
  let subtotal = 0;
  for (const item of items) {
    subtotal += item.unit_price * item.qty;
  }
  
  let discount_amount = 0;
  if (discount_type === 'percent') {
    discount_amount = (subtotal * discount_value) / 100;
  } else if (discount_type === 'fixed') {
    discount_amount = discount_value;
  }
  
  const total_amount = subtotal + additional_charges - discount_amount;
  
  // Use transaction for atomic operations
  const transaction = db.transaction(() => {
    // Insert order
    const orderResult = db.prepare(`
      INSERT INTO orders (staff_id, date, additional_charges, total_amount, 
                          customer_name, tender_cash, discount_type, discount_value, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(staff_id, getCurrentUTCTimestamp(), additional_charges, total_amount, customer_name, 
           tender_cash, discount_type, discount_value, status);
    
    const orderId = orderResult.lastInsertRowid;
    
    // Insert order items and update stock
    const insertItem = db.prepare('INSERT INTO item_variant_order (item_variant_id, order_id, qty, unit_price, discount_source, discount_type, discount_value, discount_amount, original_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const getBatches = db.prepare('SELECT id, remaining_qty FROM stock_batch WHERE item_variant_id = ? AND remaining_qty > 0 ORDER BY expire_date ASC, created_at ASC');
    const updateBatch = db.prepare('UPDATE stock_batch SET remaining_qty = remaining_qty - ? WHERE id = ?');
    
    for (const item of items) {
      insertItem.run(
        item.item_variant_id, orderId, item.qty, item.unit_price,
        item.discount_source || null,
        item.discount_type || null,
        parseFloat(item.discount_value) || 0,
        parseFloat(item.discount_amount) || 0,
        parseFloat(item.original_price) || item.unit_price
      );
      
      // Deduct stock using FIFO (by expiry date first, then created date)
      const batches = getBatches.all(item.item_variant_id);
      let remainingQty = item.qty;
      
      for (const batch of batches) {
        if (remainingQty <= 0) break;
        
        const deductQty = Math.min(remainingQty, batch.remaining_qty);
        updateBatch.run(deductQty, batch.id);
        remainingQty -= deductQty;
      }
    }
    
    // Update cashier shift cash amount for completed orders
    if (status === 'completed') {
      db.prepare(`
        UPDATE cashier_shift 
        SET current_cash_onhand = current_cash_onhand + ? 
        WHERE staff_id = ? AND status = 'open'
      `).run(total_amount, staff_id);
    }
    
    return orderId;
  });
  
  try {
    const orderId = transaction();
    res.status(201).json({
      id: orderId,
      total_amount,
      status,
      message: 'Order created successfully'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update order status
router.put('/:id/status', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { status } = req.body;
  
  if (!['active', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  try {
    // If cancelling order, restore stock
    if (status === 'cancelled') {
      const transaction = db.transaction(() => {
        // Get order items
        const items = db.prepare('SELECT item_variant_id, qty FROM item_variant_order WHERE order_id = ?').all(id);
        
        if (items.length === 0) {
          // No items to restore, just update status
          const result = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
          return { changes: result.changes, message: 'Order status updated successfully' };
        }
        
        // Restore stock using LIFO (Last In, First Out) - reverse of FIFO
        const getBatches = db.prepare('SELECT id FROM stock_batch WHERE item_variant_id = ? ORDER BY created_at DESC');
        const updateBatch = db.prepare('UPDATE stock_batch SET remaining_qty = remaining_qty + ? WHERE id = ?');
        
        for (const item of items) {
          const batches = getBatches.all(item.item_variant_id);
          if (batches.length > 0) {
            // Restore all qty to the most recent batch
            updateBatch.run(item.qty, batches[0].id);
          }
        }
        
        // Update order status
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
        
        return { message: 'Order cancelled and stock restored successfully' };
      });
      
      const result = transaction();
      res.json(result);
    } else {
      // For other status updates
      const transaction = db.transaction(() => {
        // Get order details
        const order = db.prepare('SELECT total_amount, staff_id, status as current_status FROM orders WHERE id = ?').get(id);
        
        if (!order) {
          throw new Error('Order not found');
        }
        
        // Update order status
        const result = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
        
        if (result.changes === 0) {
          throw new Error('Order not found');
        }
        
        // If status changed to 'completed' and was not already completed, update cash
        if (status === 'completed' && order.current_status !== 'completed') {
          db.prepare(`
            UPDATE cashier_shift 
            SET current_cash_onhand = current_cash_onhand + ? 
            WHERE staff_id = ? AND status = 'open'
          `).run(order.total_amount, order.staff_id);
        }
        
        return { message: 'Order status updated successfully' };
      });
      
      try {
        const result = transaction();
        res.json(result);
      } catch (err) {
        if (err.message === 'Order not found') {
          return res.status(404).json({ error: err.message });
        }
        throw err;
      }
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update order items and details
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { 
    staff_id,
    additional_charges = 0, 
    customer_name, 
    discount_type,
    discount_value = 0,
    status,
    tender_cash,
    items 
  } = req.body;
  
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Items are required' });
  }

  // Calculate total amount
  // unit_price is already the discounted price (item/brand/global discounts applied)
  let subtotal = 0;
  for (const item of items) {
    subtotal += item.unit_price * item.qty;
  }
  
  let discount_amount = 0;
  if (discount_type === 'percent') {
    discount_amount = (subtotal * discount_value) / 100;
  } else if (discount_type === 'fixed') {
    discount_amount = discount_value;
  }
  
  const total_amount = subtotal + additional_charges - discount_amount;
  
  try {
    const transaction = db.transaction(() => {
      // Get old order details
      const oldOrder = db.prepare('SELECT total_amount as old_total, status as old_status, staff_id FROM orders WHERE id = ?').get(id);
      if (!oldOrder) {
        throw new Error('Order not found');
      }
      
      // Update order
      const updateResult = db.prepare(`
        UPDATE orders SET additional_charges = ?, total_amount = ?, 
                         customer_name = ?, discount_type = ?, discount_value = ?, status = ? 
        WHERE id = ?
      `).run(additional_charges, total_amount, customer_name, discount_type, discount_value, status, id);
      
      if (updateResult.changes === 0) {
        throw new Error('Order not found');
      }
      
      // Get old items and restore their stock
      const oldItems = db.prepare('SELECT item_variant_id, qty FROM item_variant_order WHERE order_id = ?').all(id);
      const getBatches = db.prepare('SELECT id FROM stock_batch WHERE item_variant_id = ? ORDER BY created_at DESC');
      const restoreBatch = db.prepare('UPDATE stock_batch SET remaining_qty = remaining_qty + ? WHERE id = ?');
      
      for (const oldItem of oldItems) {
        const batches = getBatches.all(oldItem.item_variant_id);
        if (batches.length > 0) {
          restoreBatch.run(oldItem.qty, batches[0].id);
        }
      }
      
      // Delete old order items
      db.prepare('DELETE FROM item_variant_order WHERE order_id = ?').run(id);
      
      // Insert new order items and deduct stock
      const insertItem = db.prepare('INSERT INTO item_variant_order (item_variant_id, order_id, qty, unit_price, discount_source, discount_type, discount_value, discount_amount, original_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      const getFifoBatches = db.prepare('SELECT id, remaining_qty FROM stock_batch WHERE item_variant_id = ? AND remaining_qty > 0 ORDER BY created_at ASC');
      const deductBatch = db.prepare('UPDATE stock_batch SET remaining_qty = remaining_qty - ? WHERE id = ?');
      
      for (const item of items) {
        insertItem.run(
          item.item_variant_id, id, item.qty, item.unit_price,
          item.discount_source || null,
          item.discount_type || null,
          parseFloat(item.discount_value) || 0,
          parseFloat(item.discount_amount) || 0,
          parseFloat(item.original_price) || item.unit_price
        );
        
        // Deduct stock using FIFO
        const batches = getFifoBatches.all(item.item_variant_id);
        let remainingQty = item.qty;
        
        for (const batch of batches) {
          if (remainingQty <= 0) break;
          
          const deductQty = Math.min(remainingQty, batch.remaining_qty);
          deductBatch.run(deductQty, batch.id);
          remainingQty -= deductQty;
        }
      }
      
      // Adjust cashier cash based on status and total changes
      let cash_change = 0;
      if (status === 'completed') {
        if (oldOrder.old_status === 'completed') {
          cash_change = total_amount - oldOrder.old_total;
        } else {
          cash_change = total_amount;
        }
      } else {
        if (oldOrder.old_status === 'completed') {
          cash_change = -oldOrder.old_total;
        }
      }
      
      if (cash_change !== 0) {
        db.prepare(`
          UPDATE cashier_shift 
          SET current_cash_onhand = current_cash_onhand + ? 
          WHERE staff_id = ? AND status = 'open'
        `).run(cash_change, oldOrder.staff_id);
      }
      
      return { id: id, total_amount };
    });
    
    const result = transaction();
    res.json({
      id: result.id,
      total_amount: result.total_amount,
      message: 'Order updated successfully'
    });
  } catch (err) {
    if (err.message === 'Order not found') {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// Get daily sales summary
router.get('/reports/daily', (req, res) => {
  const db = getDatabase();
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];
  
  try {
    const summary = db.prepare(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(total_amount) as total_sales,
        SUM(additional_charges) as total_charges,
        SUM(discount_value) as total_discounts,
        AVG(total_amount) as average_order_value
      FROM orders 
      WHERE DATE(date) = ? AND status = 'completed'
    `).get(targetDate);
    
    const topItems = db.prepare(`
      SELECT i.name as item_name, v.variant_name, 
             SUM(ivo.qty) as total_qty,
             SUM(ivo.qty * ivo.unit_price) as total_revenue
      FROM item_variant_order ivo
      JOIN orders o ON ivo.order_id = o.id
      JOIN item_variant iv ON ivo.item_variant_id = iv.id
      JOIN item i ON iv.item_id = i.id
      JOIN variant v ON iv.variant_id = v.id
      WHERE DATE(o.date) = ? AND o.status = 'completed'
      GROUP BY ivo.item_variant_id
      ORDER BY total_qty DESC
      LIMIT 10
    `).all(targetDate);
    
    res.json({
      date: targetDate,
      summary: summary,
      top_items: topItems
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;