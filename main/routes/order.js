const express = require('express');
const router = express.Router();
const { getDatabase, getCurrentUTCTimestamp } = require('../database/init');

const isValidOrderStatus = (status) => ['active', 'completed', 'cancelled'].includes(status);

const parsePositiveInteger = (value, label) => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
};

const parseNonNegativeNumber = (value, label) => {
  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed;
};

const parseOptionalNumber = (value, fallback = 0) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeOrderItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items are required');
  }

  return items.map((item, index) => {
    const row = index + 1;
    const itemVariantId = parsePositiveInteger(item.item_variant_id, `item_variant_id at row ${row}`);
    const qty = parsePositiveInteger(item.qty, `qty at row ${row}`);
    const unitPrice = parseNonNegativeNumber(item.unit_price, `unit_price at row ${row}`);
    const originalPrice = parseOptionalNumber(item.original_price, unitPrice);

    return {
      item_variant_id: itemVariantId,
      qty,
      unit_price: unitPrice,
      original_price: originalPrice,
      discount_source: item.discount_source || null,
      discount_type: item.discount_type || null,
      discount_value: parseOptionalNumber(item.discount_value, 0),
      discount_amount: parseOptionalNumber(item.discount_amount, 0),
      preferred_batch_id: item.preferred_batch_id ? parseInt(item.preferred_batch_id, 10) : null,
    };
  });
};

const allocateOrderItemAcrossBatches = (db, { orderId, orderItemId, itemVariantId, qty, soldUnitPrice, preferredBatchId = null }) => {
  // If preferredBatchId is given, that batch is sorted first; CASE returns NULL for null param → falls back to pure FIFO automatically
  const getBatches = db.prepare(`
    SELECT id, remaining_qty, buy_price, COALESCE(sell_price, 0) AS sell_price
    FROM stock_batch
    WHERE item_variant_id = ? AND remaining_qty > 0
    ORDER BY
      CASE WHEN id = ? THEN 0 ELSE 1 END,
      CASE WHEN expire_date IS NULL THEN 1 ELSE 0 END,
      DATE(expire_date) ASC,
      created_at ASC,
      id ASC
  `);
  const updateBatch = db.prepare('UPDATE stock_batch SET remaining_qty = remaining_qty - ? WHERE id = ?');
  const insertAllocation = db.prepare(`
    INSERT INTO item_variant_order_batch (
      order_item_id,
      order_id,
      item_variant_id,
      stock_batch_id,
      qty,
      batch_buy_price,
      batch_sell_price,
      sold_unit_price
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const batches = getBatches.all(itemVariantId, preferredBatchId);
  let remainingQty = qty;
  let allocatedQty = 0;

  for (const batch of batches) {
    if (remainingQty <= 0) {
      break;
    }

    const deductQty = Math.min(remainingQty, batch.remaining_qty);
    updateBatch.run(deductQty, batch.id);
    insertAllocation.run(
      orderItemId,
      orderId,
      itemVariantId,
      batch.id,
      deductQty,
      parseOptionalNumber(batch.buy_price, 0),
      parseOptionalNumber(batch.sell_price, 0),
      soldUnitPrice
    );

    allocatedQty += deductQty;
    remainingQty -= deductQty;
  }

  if (remainingQty > 0) {
    throw new Error(`Insufficient stock for item variant ${itemVariantId}. Requested ${qty}, available ${allocatedQty}`);
  }
};

const clearOrderAllocations = (db, orderId) => {
  db.prepare('DELETE FROM item_variant_order_batch WHERE order_id = ?').run(orderId);
};

const restoreOrderStock = (db, orderId) => {
  const allocations = db.prepare(`
    SELECT stock_batch_id, qty
    FROM item_variant_order_batch
    WHERE order_id = ?
    ORDER BY id ASC
  `).all(orderId);

  if (allocations.length > 0) {
    const restoreBatch = db.prepare('UPDATE stock_batch SET remaining_qty = remaining_qty + ? WHERE id = ?');
    for (const allocation of allocations) {
      restoreBatch.run(allocation.qty, allocation.stock_batch_id);
    }
    clearOrderAllocations(db, orderId);
    return;
  }

  // Legacy fallback for orders created before allocation persistence.
  const items = db.prepare('SELECT item_variant_id, qty FROM item_variant_order WHERE order_id = ?').all(orderId);
  const getLatestBatch = db.prepare('SELECT id FROM stock_batch WHERE item_variant_id = ? ORDER BY created_at DESC, id DESC');
  const restoreBatch = db.prepare('UPDATE stock_batch SET remaining_qty = remaining_qty + ? WHERE id = ?');

  for (const item of items) {
    const batches = getLatestBatch.all(item.item_variant_id);
    if (batches.length > 0) {
      restoreBatch.run(item.qty, batches[0].id);
    }
  }
};

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

    const allocations = db.prepare(`
      SELECT
        iob.order_item_id,
        iob.stock_batch_id,
        iob.qty,
        iob.batch_buy_price,
        iob.batch_sell_price,
        iob.sold_unit_price,
        sb.expire_date,
        sb.created_at as batch_created_at
      FROM item_variant_order_batch iob
      LEFT JOIN stock_batch sb ON iob.stock_batch_id = sb.id
      WHERE iob.order_id = ?
      ORDER BY iob.order_item_id ASC, iob.id ASC
    `).all(id);

    const allocationMap = allocations.reduce((acc, allocation) => {
      if (!acc[allocation.order_item_id]) {
        acc[allocation.order_item_id] = [];
      }
      acc[allocation.order_item_id].push(allocation);
      return acc;
    }, {});

    const itemsWithAllocations = items.map((item) => ({
      ...item,
      batch_allocations: allocationMap[item.id] || []
    }));
    
    res.json({
      ...order,
      items: itemsWithAllocations
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
  
  if (!staff_id) {
    return res.status(400).json({ error: 'Staff ID is required' });
  }

  if (!isValidOrderStatus(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  let normalizedItems;
  try {
    normalizedItems = normalizeOrderItems(items);
  } catch (validationError) {
    return res.status(400).json({ error: validationError.message });
  }

  const safeAdditionalCharges = parseOptionalNumber(additional_charges, 0);
  const safeDiscountValue = parseOptionalNumber(discount_value, 0);
  const safeTenderCash = tender_cash === undefined ? null : parseOptionalNumber(tender_cash, 0);
  
  // Calculate total amount
  // unit_price is already the discounted price (item/brand/global discounts applied)
  let subtotal = 0;
  for (const item of normalizedItems) {
    subtotal += item.unit_price * item.qty;
  }
  
  let discount_amount = 0;
  if (discount_type === 'percent') {
    discount_amount = (subtotal * safeDiscountValue) / 100;
  } else if (discount_type === 'fixed') {
    discount_amount = safeDiscountValue;
  }
  
  const total_amount = subtotal + safeAdditionalCharges - discount_amount;
  
  // Use transaction for atomic operations
  const transaction = db.transaction(() => {
    // Insert order
    const orderResult = db.prepare(`
      INSERT INTO orders (staff_id, date, additional_charges, total_amount, 
                          customer_name, tender_cash, discount_type, discount_value, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(staff_id, getCurrentUTCTimestamp(), safeAdditionalCharges, total_amount, customer_name,
           safeTenderCash, discount_type, safeDiscountValue, status);
    
    const orderId = orderResult.lastInsertRowid;
    
    // Insert order items and update stock
    const insertItem = db.prepare('INSERT INTO item_variant_order (item_variant_id, order_id, qty, unit_price, discount_source, discount_type, discount_value, discount_amount, original_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    
    for (const item of normalizedItems) {
      const itemResult = insertItem.run(
        item.item_variant_id, orderId, item.qty, item.unit_price,
        item.discount_source,
        item.discount_type,
        item.discount_value,
        item.discount_amount,
        item.original_price
      );

      if (status !== 'cancelled') {
        allocateOrderItemAcrossBatches(db, {
          orderId,
          orderItemId: itemResult.lastInsertRowid,
          itemVariantId: item.item_variant_id,
          qty: item.qty,
          soldUnitPrice: item.unit_price,
          preferredBatchId: item.preferred_batch_id || null,
        });
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
    if (err.message && err.message.startsWith('Insufficient stock')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update order status
router.put('/:id/status', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { status } = req.body;
  
  if (!isValidOrderStatus(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  try {
    const transaction = db.transaction(() => {
      const order = db.prepare('SELECT total_amount, staff_id, status as current_status FROM orders WHERE id = ?').get(id);

      if (!order) {
        throw new Error('Order not found');
      }

      if (order.current_status === status) {
        return { message: `Order already in ${status} status` };
      }

      // Cancel: restore exact consumed batches.
      if (status === 'cancelled' && order.current_status !== 'cancelled') {
        restoreOrderStock(db, id);
      }

      // Re-open cancelled order: reserve stock again based on current order items.
      if (status !== 'cancelled' && order.current_status === 'cancelled') {
        const existingItems = db.prepare(`
          SELECT id, item_variant_id, qty, unit_price
          FROM item_variant_order
          WHERE order_id = ?
        `).all(id);

        clearOrderAllocations(db, id);
        for (const item of existingItems) {
          allocateOrderItemAcrossBatches(db, {
            orderId: id,
            orderItemId: item.id,
            itemVariantId: item.item_variant_id,
            qty: item.qty,
            soldUnitPrice: parseOptionalNumber(item.unit_price, 0)
          });
        }
      }

      const result = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
      if (result.changes === 0) {
        throw new Error('Order not found');
      }

      let cashChange = 0;
      if (order.current_status !== 'completed' && status === 'completed') {
        cashChange = order.total_amount;
      } else if (order.current_status === 'completed' && status !== 'completed') {
        cashChange = -order.total_amount;
      }

      if (cashChange !== 0) {
        db.prepare(`
          UPDATE cashier_shift
          SET current_cash_onhand = current_cash_onhand + ?
          WHERE staff_id = ? AND status = 'open'
        `).run(cashChange, order.staff_id);
      }

      if (status === 'cancelled') {
        return { message: 'Order cancelled and stock restored successfully' };
      }
      return { message: 'Order status updated successfully' };
    });

    const result = transaction();
    res.json(result);
  } catch (err) {
    if (err.message === 'Order not found') {
      return res.status(404).json({ error: err.message });
    }
    if (err.message && err.message.startsWith('Insufficient stock')) {
      return res.status(400).json({ error: err.message });
    }
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

  let normalizedItems;
  try {
    normalizedItems = normalizeOrderItems(items);
  } catch (validationError) {
    return res.status(400).json({ error: validationError.message });
  }

  if (status !== undefined && !isValidOrderStatus(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const safeAdditionalCharges = parseOptionalNumber(additional_charges, 0);
  const safeDiscountValue = parseOptionalNumber(discount_value, 0);
  const safeTenderCash = tender_cash === undefined ? null : parseOptionalNumber(tender_cash, 0);

  // Calculate total amount
  // unit_price is already the discounted price (item/brand/global discounts applied)
  let subtotal = 0;
  for (const item of normalizedItems) {
    subtotal += item.unit_price * item.qty;
  }
  
  let discount_amount = 0;
  if (discount_type === 'percent') {
    discount_amount = (subtotal * safeDiscountValue) / 100;
  } else if (discount_type === 'fixed') {
    discount_amount = safeDiscountValue;
  }
  
  const total_amount = subtotal + safeAdditionalCharges - discount_amount;
  
  try {
    const transaction = db.transaction(() => {
      // Get old order details
      const oldOrder = db.prepare(`
        SELECT total_amount as old_total, status as old_status, staff_id, tender_cash
        FROM orders
        WHERE id = ?
      `).get(id);
      if (!oldOrder) {
        throw new Error('Order not found');
      }

      const resolvedStatus = status || oldOrder.old_status;
      const resolvedStaffId = staff_id || oldOrder.staff_id;
      const resolvedTenderCash = safeTenderCash === null ? oldOrder.tender_cash : safeTenderCash;
      
      // Update order
      const updateResult = db.prepare(`
        UPDATE orders SET staff_id = ?, additional_charges = ?, total_amount = ?, 
                         customer_name = ?, discount_type = ?, discount_value = ?, status = ?, tender_cash = ?
        WHERE id = ?
      `).run(
        resolvedStaffId,
        safeAdditionalCharges,
        total_amount,
        customer_name,
        discount_type,
        safeDiscountValue,
        resolvedStatus,
        resolvedTenderCash,
        id
      );
      
      if (updateResult.changes === 0) {
        throw new Error('Order not found');
      }
      
      // Restore previously reserved stock only for non-cancelled orders.
      if (oldOrder.old_status !== 'cancelled') {
        restoreOrderStock(db, id);
      } else {
        clearOrderAllocations(db, id);
      }
      
      // Delete old order items
      db.prepare('DELETE FROM item_variant_order WHERE order_id = ?').run(id);
      
      // Insert new order items and deduct stock
      const insertItem = db.prepare('INSERT INTO item_variant_order (item_variant_id, order_id, qty, unit_price, discount_source, discount_type, discount_value, discount_amount, original_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      
      for (const item of normalizedItems) {
        const itemResult = insertItem.run(
          item.item_variant_id, id, item.qty, item.unit_price,
          item.discount_source,
          item.discount_type,
          item.discount_value,
          item.discount_amount,
          item.original_price
        );
        
        if (resolvedStatus !== 'cancelled') {
          allocateOrderItemAcrossBatches(db, {
            orderId: id,
            orderItemId: itemResult.lastInsertRowid,
            itemVariantId: item.item_variant_id,
            qty: item.qty,
            soldUnitPrice: item.unit_price,
            preferredBatchId: item.preferred_batch_id || null,
          });
        }
      }
      
      // Adjust cashier cash based on status and total changes
      let cash_change = 0;
      if (resolvedStatus === 'completed') {
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
        `).run(cash_change, resolvedStaffId);
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
    if (err.message && err.message.startsWith('Insufficient stock')) {
      return res.status(400).json({ error: err.message });
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
      WITH sales_rows AS (
        SELECT
          iob.item_variant_id,
          iob.order_id,
          iob.qty,
          iob.sold_unit_price as unit_price
        FROM item_variant_order_batch iob
        JOIN orders o ON iob.order_id = o.id
        WHERE DATE(o.date) = ? AND o.status = 'completed'

        UNION ALL

        SELECT
          ivo.item_variant_id,
          ivo.order_id,
          ivo.qty,
          ivo.unit_price
        FROM item_variant_order ivo
        JOIN orders o ON ivo.order_id = o.id
        WHERE DATE(o.date) = ? AND o.status = 'completed'
          AND NOT EXISTS (
            SELECT 1
            FROM item_variant_order_batch iob2
            WHERE iob2.order_item_id = ivo.id
          )
      )
      SELECT i.name as item_name, v.variant_name,
             SUM(sr.qty) as total_qty,
             SUM(sr.qty * sr.unit_price) as total_revenue
      FROM sales_rows sr
      JOIN item_variant iv ON sr.item_variant_id = iv.id
      JOIN item i ON iv.item_id = i.id
      JOIN variant v ON iv.variant_id = v.id
      GROUP BY sr.item_variant_id
      ORDER BY total_qty DESC
      LIMIT 10
    `).all(targetDate, targetDate);
    
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