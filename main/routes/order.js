const express = require('express');
const router = express.Router();
const { getDatabase, getCurrentUTCTimestamp, generateUniqueBarcode } = require('../database/init');

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

const parseOptionalText = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no'].includes(normalized)) {
    return false;
  }
  return fallback;
};

const calculateOrderCashImpact = (totalAmount, isCardPayment) => {
  return parseBoolean(isCardPayment, false) ? 0 : parseOptionalNumber(totalAmount, 0);
};

const normalizeOrderItems = (items, { allowEmpty = false } = {}) => {
  if (!Array.isArray(items)) {
    if (allowEmpty) {
      return [];
    }
    throw new Error('Items are required');
  }

  if (!allowEmpty && items.length === 0) {
    throw new Error('Items are required');
  }

  return items.map((item, index) => {
    const row = index + 1;
    const itemVariantId = parsePositiveInteger(item.item_variant_id, `item_variant_id at row ${row}`);
    const qty = parsePositiveInteger(item.qty, `qty at row ${row}`);
    const unitPrice = parseNonNegativeNumber(item.unit_price, `unit_price at row ${row}`);
    const originalPrice = parseOptionalNumber(item.original_price, unitPrice);
    const rawDiscountType = item.discount_type || null;
    const discountType = ['fixed', 'percentage'].includes(rawDiscountType) ? rawDiscountType : null;
    const rawDiscountValue = parseOptionalNumber(item.discount_value, 0);

    const safeDiscountValue = discountType === 'percentage'
      ? Math.min(100, Math.max(0, rawDiscountValue))
      : Math.max(0, rawDiscountValue);

    // Item discount persistence should come from price delta, not client-provided amount.
    const computedDiscountAmount = Math.max(0, Math.round((originalPrice - unitPrice) * 100) / 100);

    let preferredBatchId = null;
    if (item.preferred_batch_id !== undefined && item.preferred_batch_id !== null && item.preferred_batch_id !== '') {
      preferredBatchId = parsePositiveInteger(item.preferred_batch_id, `preferred_batch_id at row ${row}`);
    }

    return {
      item_variant_id: itemVariantId,
      qty,
      unit_price: unitPrice,
      original_price: originalPrice,
      discount_source: item.discount_source || null,
      discount_type: discountType,
      discount_value: safeDiscountValue,
      discount_amount: computedDiscountAmount,
      preferred_batch_id: preferredBatchId,
    };
  });
};

const normalizeReturnItems = (returnItems) => {
  if (returnItems === undefined || returnItems === null) {
    return [];
  }

  if (!Array.isArray(returnItems)) {
    throw new Error('return_items must be an array');
  }

  return returnItems.map((item, index) => {
    const row = index + 1;
    const itemVariantId = parsePositiveInteger(item.item_variant_id, `return item_variant_id at row ${row}`);
    const qty = parsePositiveInteger(item.qty, `return qty at row ${row}`);
    const unitPrice = parseNonNegativeNumber(item.unit_price, `return unit_price at row ${row}`);
    const originalPrice = parseOptionalNumber(item.original_price, unitPrice);

    const batchAllocations = Array.isArray(item.batch_allocations)
      ? item.batch_allocations.map((allocation, allocationIndex) => {
          const allocationRow = allocationIndex + 1;
          return {
            qty: parsePositiveInteger(allocation.qty, `return batch_allocations.qty at row ${row}.${allocationRow}`),
            batch_buy_price: parseOptionalNumber(allocation.batch_buy_price, 0),
            batch_sell_price: parseOptionalNumber(allocation.batch_sell_price, originalPrice),
            sold_unit_price: parseOptionalNumber(allocation.sold_unit_price, unitPrice),
          };
        })
      : [];

    return {
      item_variant_id: itemVariantId,
      qty,
      unit_price: unitPrice,
      original_price: originalPrice,
      source_order_item_id: item.source_order_item_id ? parsePositiveInteger(item.source_order_item_id, `source_order_item_id at row ${row}`) : null,
      batch_buy_price: parseOptionalNumber(item.batch_buy_price, 0),
      batch_sell_price: parseOptionalNumber(item.batch_sell_price, originalPrice),
      description: parseOptionalText(item.description),
      batch_allocations: batchAllocations,
    };
  });
};

const calculateDiscountAmount = (subtotal, discountType, discountValue) => {
  if (discountType === 'percent') {
    const safePercent = Math.min(100, Math.max(0, parseOptionalNumber(discountValue, 0)));
    return (subtotal * safePercent) / 100;
  }
  if (discountType === 'fixed') {
    const safeFixed = Math.max(0, parseOptionalNumber(discountValue, 0));
    return Math.min(safeFixed, subtotal);
  }
  return 0;
};

const getGlobalDiscountSettings = (db) => {
  try {
    const row = db.prepare(`
      SELECT
        COALESCE(is_global_discount_active, 0) AS is_global_discount_active,
        COALESCE(global_discount_type, 'percentage') AS global_discount_type,
        COALESCE(global_discount_value, 0) AS global_discount_value,
        COALESCE(min_order_amount, 0) AS min_order_amount
      FROM global_discount_settings
      WHERE key_value = ?
      LIMIT 1
    `).get('default');

    if (!row) {
      return {
        isGlobalDiscountActive: false,
        globalDiscountType: 'percentage',
        globalDiscountValue: 0,
        minOrderAmount: 0,
      };
    }

    return {
      isGlobalDiscountActive: parseBoolean(row.is_global_discount_active, false),
      globalDiscountType: String(row.global_discount_type || 'percentage'),
      globalDiscountValue: parseOptionalNumber(row.global_discount_value, 0),
      minOrderAmount: parseOptionalNumber(row.min_order_amount, 0),
    };
  } catch (_error) {
    return {
      isGlobalDiscountActive: false,
      globalDiscountType: 'percentage',
      globalDiscountValue: 0,
      minOrderAmount: 0,
    };
  }
};

const normalizeOrderDiscountForGlobalRules = (db, {
  subtotal,
  discountType,
  discountValue,
  isReturn = false,
}) => {
  if (isReturn) {
    return {
      discountType: null,
      discountValue: 0,
      discountAmount: 0,
    };
  }

  const safeDiscountType = discountType || null;
  const safeDiscountValue = parseOptionalNumber(discountValue, 0);

  let effectiveDiscountType = safeDiscountType;
  let effectiveDiscountValue = safeDiscountValue;

  const settings = getGlobalDiscountSettings(db);
  if (settings.isGlobalDiscountActive) {
    const globalTypeForOrders = settings.globalDiscountType === 'percentage' ? 'percent' : 'fixed';
    const matchesGlobalConfig =
      safeDiscountType === globalTypeForOrders
      && Math.abs(safeDiscountValue - settings.globalDiscountValue) < 0.0001;

    if (matchesGlobalConfig && subtotal < settings.minOrderAmount) {
      effectiveDiscountType = null;
      effectiveDiscountValue = 0;
    }
  }

  const discountAmount = calculateDiscountAmount(subtotal, effectiveDiscountType, effectiveDiscountValue);

  return {
    discountType: effectiveDiscountType,
    discountValue: effectiveDiscountValue,
    discountAmount,
  };
};

const allocateOrderItemAcrossBatches = (db, { orderId, orderItemId, itemVariantId, qty, soldUnitPrice, preferredBatchId = null }) => {
  // If preferredBatchId is given, that batch is sorted first; CASE returns NULL for null param -> falls back to FIFO.
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
    INSERT INTO order_item_batch_allocation (
      item_variant_order_id,
      stock_batch_id,
      qty_allocated
    ) VALUES (?, ?, ?)
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
      batch.id,
      deductQty
    );

    allocatedQty += deductQty;
    remainingQty -= deductQty;
  }

  if (remainingQty > 0) {
    throw new Error(`Insufficient stock for item variant ${itemVariantId}. Requested ${qty}, available ${allocatedQty}`);
  }
};

const insertReturnStockForItem = (db, {
  orderId,
  orderItemId,
  originalOrderId,
  returnItem,
}) => {
  const insertStockBatch = db.prepare(`
    INSERT INTO stock_batch (
      item_variant_id,
      buy_price,
      sell_price,
      initial_qty,
      remaining_qty,
      created_at,
      description,
      is_returned
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const insertAllocation = db.prepare(`
    INSERT INTO order_item_batch_allocation (
      item_variant_order_id,
      stock_batch_id,
      qty_allocated
    ) VALUES (?, ?, ?)
  `);

  const description = returnItem.description || `Return stock from order #${originalOrderId}`;
  const createdAt = getCurrentUTCTimestamp();

  const addReturnBatch = ({ qty, buyPrice, sellPrice, soldUnitPrice }) => {
    const batchResult = insertStockBatch.run(
      returnItem.item_variant_id,
      parseOptionalNumber(buyPrice, 0),
      parseOptionalNumber(sellPrice, returnItem.original_price),
      qty,
      qty,
      createdAt,
      description
    );

    const returnStockBatchId = batchResult.lastInsertRowid;
    insertAllocation.run(
      orderItemId,
      returnStockBatchId,
      qty
    );
  };

  let remainingQty = returnItem.qty;
  if (returnItem.batch_allocations.length > 0) {
    for (const allocation of returnItem.batch_allocations) {
      if (remainingQty <= 0) {
        break;
      }

      const allocationQty = Math.min(remainingQty, allocation.qty);
      addReturnBatch({
        qty: allocationQty,
        buyPrice: allocation.batch_buy_price,
        sellPrice: allocation.batch_sell_price,
        soldUnitPrice: allocation.sold_unit_price,
      });
      remainingQty -= allocationQty;
    }
  }

  if (remainingQty > 0) {
    addReturnBatch({
      qty: remainingQty,
      buyPrice: returnItem.batch_buy_price,
      sellPrice: returnItem.batch_sell_price,
      soldUnitPrice: returnItem.unit_price,
    });
  }
};

const clearOrderAllocations = (db, orderId) => {
  db.prepare(`
    DELETE FROM order_item_batch_allocation
    WHERE item_variant_order_id IN (
      SELECT id FROM item_variant_order WHERE order_id = ?
    )
  `).run(orderId);
};

const restoreOrderStock = (db, orderId) => {
  const allocations = db.prepare(`
    SELECT oiba.stock_batch_id, oiba.qty_allocated, ivo.qty AS order_item_qty
    FROM order_item_batch_allocation oiba
    JOIN item_variant_order ivo ON ivo.id = oiba.item_variant_order_id
    WHERE ivo.order_id = ?
    ORDER BY oiba.id ASC
  `).all(orderId);

  if (allocations.length > 0) {
    const restoreSoldBatch = db.prepare('UPDATE stock_batch SET remaining_qty = remaining_qty + ? WHERE id = ?');
    const rollbackReturnBatch = db.prepare(`
      UPDATE stock_batch
      SET remaining_qty = CASE WHEN remaining_qty - ? < 0 THEN 0 ELSE remaining_qty - ? END
      WHERE id = ?
    `);

    for (const allocation of allocations) {
      if (parseInt(allocation.order_item_qty, 10) < 0) {
        rollbackReturnBatch.run(allocation.qty_allocated, allocation.qty_allocated, allocation.stock_batch_id);
      } else {
        restoreSoldBatch.run(allocation.qty_allocated, allocation.stock_batch_id);
      }
    }

    clearOrderAllocations(db, orderId);
    return;
  }

  // Legacy fallback for orders created before allocation persistence.
  const items = db.prepare('SELECT item_variant_id, qty FROM item_variant_order WHERE order_id = ?').all(orderId);
  const getLatestBatch = db.prepare('SELECT id FROM stock_batch WHERE item_variant_id = ? ORDER BY created_at DESC, id DESC');
  const restoreBatch = db.prepare('UPDATE stock_batch SET remaining_qty = remaining_qty + ? WHERE id = ?');

  for (const item of items) {
    if (item.qty <= 0) {
      continue;
    }
    const batches = getLatestBatch.all(item.item_variant_id);
    if (batches.length > 0) {
      restoreBatch.run(item.qty, batches[0].id);
    }
  }
};

const validateReturnQuantities = (db, originalOrderId, returnItems) => {
  if (returnItems.length === 0) {
    return;
  }

  const requestedByVariant = returnItems.reduce((acc, item) => {
    const existingQty = acc.get(item.item_variant_id) || 0;
    acc.set(item.item_variant_id, existingQty + item.qty);
    return acc;
  }, new Map());

  const soldQtyStmt = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN qty > 0 THEN qty ELSE 0 END), 0) AS sold_qty
    FROM item_variant_order
    WHERE order_id = ? AND item_variant_id = ?
  `);

  const returnedQtyStmt = db.prepare(`
    SELECT COALESCE(SUM(ABS(rivo.qty)), 0) AS returned_qty
    FROM orders ro
    JOIN item_variant_order rivo ON rivo.order_id = ro.id
    WHERE COALESCE(ro.is_return, 0) = 1
      AND ro.original_order_id = ?
      AND rivo.item_variant_id = ?
      AND rivo.qty < 0
      AND ro.status != 'cancelled'
  `);

  for (const [itemVariantId, requestedQty] of requestedByVariant.entries()) {
    const sold = soldQtyStmt.get(originalOrderId, itemVariantId);
    const alreadyReturned = returnedQtyStmt.get(originalOrderId, itemVariantId);
    const soldQty = parseOptionalNumber(sold?.sold_qty, 0);
    const returnedQty = parseOptionalNumber(alreadyReturned?.returned_qty, 0);
    const availableQty = Math.max(0, soldQty - returnedQty);

    if (requestedQty > availableQty) {
      throw new Error(`Return quantity exceeds available quantity for item variant ${itemVariantId}. Requested ${requestedQty}, available ${availableQty}`);
    }
  }
};

// Get all orders
router.get('/', (req, res) => {
  const db = getDatabase();
  const {
    status,
    date_from,
    date_to,
    search,
    is_return,
    item_search,
    page = 1,
    limit = 10,
  } = req.query;

  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 200);

  try {
    // Check if we need to join with item_variant_order for item search
    const hasItemSearch = item_search && String(item_search).trim();
    
    let query = `
      SELECT DISTINCT o.*, CASE WHEN s.name = 'Admin' THEN 'System' ELSE s.name END as staff_name
      FROM orders o
      JOIN staff s ON o.staff_id = s.id
    `;
    
    if (hasItemSearch) {
      query += `
        JOIN item_variant_order ivo ON o.id = ivo.order_id
        JOIN item_variant iv ON ivo.item_variant_id = iv.id
        JOIN item i ON iv.item_id = i.id
      `;
    }
    
    const params = [];
    const conditions = [];

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

    if (search && String(search).trim()) {
      const likeSearch = `%${String(search).trim()}%`;
      conditions.push('(CAST(o.id AS TEXT) LIKE ? OR o.barcode LIKE ? OR COALESCE(o.customer_name, \'\') LIKE ?)');
      params.push(likeSearch, likeSearch, likeSearch);
    }

    if (hasItemSearch) {
      const likeItemSearch = `%${String(item_search).trim()}%`;
      conditions.push('(iv.barcode LIKE ? OR i.name LIKE ?)');
      params.push(likeItemSearch, likeItemSearch);
    }

    if (is_return !== undefined) {
      const isReturnFilter = parseBoolean(is_return, null);
      if (isReturnFilter !== null) {
        conditions.push('COALESCE(o.is_return, 0) = ?');
        params.push(isReturnFilter ? 1 : 0);
      }
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY o.date DESC, o.id DESC';

    let countQuery = 'SELECT COUNT(DISTINCT o.id) as total FROM orders o';
    if (hasItemSearch) {
      countQuery += `
        JOIN item_variant_order ivo ON o.id = ivo.order_id
        JOIN item_variant iv ON ivo.item_variant_id = iv.id
        JOIN item i ON iv.item_id = i.id
      `;
    }
    if (conditions.length > 0) {
      countQuery += ` WHERE ${conditions.join(' AND ')}`;
    }

    const countResult = db.prepare(countQuery).get(...params);
    const total = countResult.total;
    const offset = (safePage - 1) * safeLimit;

    const rows = db.prepare(`${query} LIMIT ? OFFSET ?`).all(...params, safeLimit, offset);
    const totalAmount = rows.reduce((sum, order) => sum + parseFloat(order.total_amount || 0), 0);

    res.json({
      orders: rows,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit)
      },
      totalAmount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search recently completed orders that can be returned.
router.get('/return-search', (req, res) => {
  const db = getDatabase();
  const { q = '', limit = 20 } = req.query;
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  try {
    let query = `
      SELECT
        o.id,
        o.barcode,
        o.date,
        o.total_amount,
        o.customer_name,
        o.status,
        CASE WHEN s.name = 'Admin' THEN 'System' ELSE s.name END as staff_name
      FROM orders o
      JOIN staff s ON s.id = o.staff_id
      WHERE o.status = 'completed'
        AND COALESCE(o.is_return, 0) = 0
    `;

    const params = [];
    if (String(q).trim()) {
      const like = `%${String(q).trim()}%`;
      query += ' AND (CAST(o.id AS TEXT) LIKE ? OR o.barcode LIKE ? OR COALESCE(o.customer_name, \'\') LIKE ?)';
      params.push(like, like, like);
    }

    query += ' ORDER BY o.date DESC, o.id DESC LIMIT ?';
    params.push(safeLimit);

    const rows = db.prepare(query).all(...params);
    res.json(rows);
  } catch (err) {
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
      WHERE DATE(date) = ?
        AND status = 'completed'
        AND COALESCE(is_return, 0) = 0
    `).get(targetDate);

    const topItems = db.prepare(`
      WITH sales_rows AS (
        SELECT
          ivo.item_variant_id,
          ivo.order_id,
          oiba.qty_allocated as qty,
          ivo.unit_price as unit_price
        FROM order_item_batch_allocation oiba
        JOIN item_variant_order ivo ON oiba.item_variant_order_id = ivo.id
        JOIN orders o ON ivo.order_id = o.id
        WHERE DATE(o.date) = ?
          AND o.status = 'completed'
          AND COALESCE(o.is_return, 0) = 0

        UNION ALL

        SELECT
          ivo.item_variant_id,
          ivo.order_id,
          ivo.qty,
          ivo.unit_price
        FROM item_variant_order ivo
        JOIN orders o ON ivo.order_id = o.id
        WHERE DATE(o.date) = ?
          AND o.status = 'completed'
          AND COALESCE(o.is_return, 0) = 0
          AND NOT EXISTS (
            SELECT 1
            FROM order_item_batch_allocation oiba2
            WHERE oiba2.item_variant_order_id = ivo.id
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
      summary,
      top_items: topItems,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get returnable details for a completed order.
router.get('/:id/returnable-items', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;

  try {
    const order = db.prepare(`
      SELECT id, barcode, date, customer_name, total_amount, status, COALESCE(is_return, 0) AS is_return
      FROM orders
      WHERE id = ?
    `).get(id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status !== 'completed') {
      return res.status(400).json({ error: 'Only completed orders can be returned' });
    }

    if (order.is_return) {
      return res.status(400).json({ error: 'Cannot create return from another return order' });
    }

    const items = db.prepare(`
      SELECT
        ivo.id as order_item_id,
        ivo.item_variant_id,
        ivo.qty,
        ivo.unit_price,
        ivo.original_price,
        i.name as item_name,
        v.variant_name,
        iv.barcode
      FROM item_variant_order ivo
      JOIN item_variant iv ON iv.id = ivo.item_variant_id
      JOIN item i ON i.id = iv.item_id
      JOIN variant v ON v.id = iv.variant_id
      WHERE ivo.order_id = ?
        AND ivo.qty > 0
      ORDER BY ivo.id ASC
    `).all(id);

    const returnTotals = db.prepare(`
      SELECT
        rivo.item_variant_id,
        COALESCE(SUM(ABS(rivo.qty)), 0) AS returned_qty
      FROM orders ro
      JOIN item_variant_order rivo ON ro.id = rivo.order_id
      WHERE COALESCE(ro.is_return, 0) = 1
        AND ro.original_order_id = ?
        AND rivo.qty < 0
        AND ro.status != 'cancelled'
      GROUP BY rivo.item_variant_id
    `).all(id);

    const returnedQtyMap = returnTotals.reduce((acc, row) => {
      acc[row.item_variant_id] = parseOptionalNumber(row.returned_qty, 0);
      return acc;
    }, {});

    const allocationRows = db.prepare(`
      SELECT
        oiba.item_variant_order_id AS order_item_id,
        oiba.stock_batch_id,
        oiba.qty_allocated AS qty,
        sb.buy_price AS batch_buy_price,
        sb.sell_price AS batch_sell_price,
        ivo.unit_price AS sold_unit_price,
        sb.expire_date,
        sb.created_at as batch_created_at
      FROM order_item_batch_allocation oiba
      JOIN item_variant_order ivo ON ivo.id = oiba.item_variant_order_id
      LEFT JOIN stock_batch sb ON sb.id = oiba.stock_batch_id
      WHERE ivo.order_id = ?
      ORDER BY oiba.item_variant_order_id ASC, oiba.id ASC
    `).all(id);

    const allocationMap = allocationRows.reduce((acc, allocation) => {
      if (!acc[allocation.order_item_id]) {
        acc[allocation.order_item_id] = [];
      }
      acc[allocation.order_item_id].push(allocation);
      return acc;
    }, {});

    const returnableItems = items
      .map((item) => {
        const soldQty = parseOptionalNumber(item.qty, 0);
        const alreadyReturnedQty = parseOptionalNumber(returnedQtyMap[item.item_variant_id], 0);
        const maxReturnableQty = Math.max(0, soldQty - alreadyReturnedQty);

        return {
          ...item,
          sold_qty: soldQty,
          already_returned_qty: alreadyReturnedQty,
          max_returnable_qty: maxReturnableQty,
          batch_allocations: allocationMap[item.order_item_id] || [],
        };
      })
      .filter((item) => item.max_returnable_qty > 0);

    res.json({
      order,
      items: returnableItems,
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
    const order = db.prepare(`
      SELECT o.*, CASE WHEN s.name = 'Admin' THEN 'System' ELSE s.name END as staff_name
      FROM orders o
      JOIN staff s ON o.staff_id = s.id
      WHERE o.id = ?
    `).get(id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

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
        oiba.item_variant_order_id AS order_item_id,
        oiba.stock_batch_id,
        oiba.qty_allocated AS qty,
        sb.buy_price AS batch_buy_price,
        sb.sell_price AS batch_sell_price,
        ivo.unit_price AS sold_unit_price,
        sb.expire_date,
        sb.created_at as batch_created_at
      FROM order_item_batch_allocation oiba
      JOIN item_variant_order ivo ON ivo.id = oiba.item_variant_order_id
      LEFT JOIN stock_batch sb ON oiba.stock_batch_id = sb.id
      WHERE ivo.order_id = ?
      ORDER BY oiba.item_variant_order_id ASC, oiba.id ASC
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
      items: itemsWithAllocations,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new order (normal or return)
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
    items,
    is_card_payment = false,
    barcode,
    is_return = false,
    original_order_id,
    credit_reason,
    return_items,
  } = req.body;

  if (!staff_id) {
    return res.status(400).json({ error: 'Staff ID is required' });
  }

  if (!isValidOrderStatus(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const safeIsReturn = parseBoolean(is_return, false);

  let normalizedItems;
  let normalizedReturnItems;
  try {
    normalizedItems = normalizeOrderItems(items, { allowEmpty: safeIsReturn });
    normalizedReturnItems = normalizeReturnItems(return_items);
  } catch (validationError) {
    return res.status(400).json({ error: validationError.message });
  }

  if (!safeIsReturn && normalizedItems.length === 0) {
    return res.status(400).json({ error: 'Items are required' });
  }

  if (safeIsReturn && !original_order_id) {
    return res.status(400).json({ error: 'original_order_id is required for return orders' });
  }

  if (safeIsReturn && normalizedReturnItems.length === 0) {
    return res.status(400).json({ error: 'return_items are required for return orders' });
  }

  if (!safeIsReturn && normalizedReturnItems.length > 0) {
    return res.status(400).json({ error: 'return_items are only allowed for return orders' });
  }

  const safeAdditionalCharges = parseOptionalNumber(additional_charges, 0);
  const safeTenderCash = tender_cash === undefined ? null : parseOptionalNumber(tender_cash, 0);
  const requestedDiscountValue = safeIsReturn ? 0 : parseOptionalNumber(discount_value, 0);
  const requestedDiscountType = safeIsReturn ? null : (discount_type || null);
  let safeOriginalOrderId = null;
  try {
    safeOriginalOrderId = safeIsReturn ? parsePositiveInteger(original_order_id, 'original_order_id') : null;
  } catch (validationError) {
    return res.status(400).json({ error: validationError.message });
  }

  const safeCreditReason = safeIsReturn ? parseOptionalText(credit_reason) : null;
  const generatedBarcode = typeof generateUniqueBarcode === 'function' ? generateUniqueBarcode() : null;
  const orderBarcode = parseOptionalText(barcode)
    || generatedBarcode
    || Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
  const safeIsCardPayment = parseBoolean(is_card_payment, false) ? 1 : 0;

  let subtotal = 0;
  for (const item of normalizedItems) {
    subtotal += item.unit_price * item.qty;
  }

  let returnCreditTotal = 0;
  for (const returnItem of normalizedReturnItems) {
    returnCreditTotal += returnItem.unit_price * returnItem.qty;
  }

  const normalizedDiscount = normalizeOrderDiscountForGlobalRules(db, {
    subtotal,
    discountType: requestedDiscountType,
    discountValue: requestedDiscountValue,
    isReturn: safeIsReturn,
  });

  const discountAmount = normalizedDiscount.discountAmount;
  const totalAmount = subtotal + safeAdditionalCharges - discountAmount - returnCreditTotal;
  const computedCreditApplied = safeIsReturn ? Math.max(totalAmount, 0) : 0;

  const transaction = db.transaction(() => {
    if (safeIsReturn) {
      const originalOrder = db.prepare(`
        SELECT id, status, COALESCE(is_return, 0) AS is_return
        FROM orders
        WHERE id = ?
      `).get(safeOriginalOrderId);

      if (!originalOrder) {
        throw new Error('Original order not found');
      }
      if (originalOrder.status !== 'completed') {
        throw new Error('Only completed orders can be returned');
      }
      if (originalOrder.is_return) {
        throw new Error('Cannot create return from another return order');
      }

      validateReturnQuantities(db, safeOriginalOrderId, normalizedReturnItems);
    }

    const orderResult = db.prepare(`
      INSERT INTO orders (
        staff_id,
        date,
        additional_charges,
        total_amount,
        customer_name,
        tender_cash,
        discount_type,
        discount_value,
        status,
        is_card_payment,
        barcode,
        is_return,
        original_order_id,
        credit_applied,
        credit_reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      staff_id,
      getCurrentUTCTimestamp(),
      safeAdditionalCharges,
      totalAmount,
      customer_name || null,
      safeTenderCash,
      normalizedDiscount.discountType,
      normalizedDiscount.discountValue,
      status,
      safeIsCardPayment,
      orderBarcode,
      safeIsReturn ? 1 : 0,
      safeOriginalOrderId,
      computedCreditApplied,
      safeCreditReason
    );

    const orderId = orderResult.lastInsertRowid;

    const insertItem = db.prepare(`
      INSERT INTO item_variant_order (
        item_variant_id,
        order_id,
        qty,
        unit_price,
        discount_source,
        discount_type,
        discount_value,
        discount_amount,
        original_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of normalizedItems) {
      const itemResult = insertItem.run(
        item.item_variant_id,
        orderId,
        item.qty,
        item.unit_price,
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

    for (const returnItem of normalizedReturnItems) {
      const returnItemResult = insertItem.run(
        returnItem.item_variant_id,
        orderId,
        -returnItem.qty,
        returnItem.unit_price,
        'return',
        null,
        0,
        0,
        returnItem.original_price
      );

      if (status !== 'cancelled') {
        insertReturnStockForItem(db, {
          orderId,
          orderItemId: returnItemResult.lastInsertRowid,
          originalOrderId: safeOriginalOrderId,
          returnItem,
        });
      }
    }

    if (status === 'completed') {
      const cashDelta = calculateOrderCashImpact(totalAmount, safeIsCardPayment);
      if (cashDelta !== 0) {
        db.prepare(`
          UPDATE cashier_shift
          SET current_cash_onhand = current_cash_onhand + ?
          WHERE staff_id = ? AND status = 'open'
        `).run(cashDelta, staff_id);
      }
    }

    return orderId;
  });

  try {
    const orderId = transaction();
    res.status(201).json({
      id: orderId,
      total_amount: totalAmount,
      status,
      barcode: orderBarcode,
      is_return: safeIsReturn,
      credit_applied: computedCreditApplied,
      return_credit_total: returnCreditTotal,
      message: 'Order created successfully',
    });
  } catch (err) {
    if (err.message && err.message.startsWith('Insufficient stock')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message && err.message.includes('Return quantity exceeds')) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message && (
      err.message === 'Original order not found' ||
      err.message === 'Only completed orders can be returned' ||
      err.message === 'Cannot create return from another return order'
    )) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message && err.message.includes('UNIQUE constraint failed: orders.barcode')) {
      return res.status(409).json({ error: 'Order barcode already exists' });
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
      const order = db.prepare(`
        SELECT total_amount, staff_id, status as current_status, COALESCE(is_return, 0) AS is_return,
               COALESCE(is_card_payment, 0) AS is_card_payment
        FROM orders
        WHERE id = ?
      `).get(id);

      if (!order) {
        throw new Error('Order not found');
      }

      if (order.current_status === status) {
        return { message: `Order already in ${status} status` };
      }

      if (status === 'cancelled' && order.current_status !== 'cancelled') {
        restoreOrderStock(db, id);
      }

      if (status !== 'cancelled' && order.current_status === 'cancelled') {
        if (order.is_return) {
          throw new Error('Cancelled return orders cannot be reopened');
        }

        const existingItems = db.prepare(`
          SELECT id, item_variant_id, qty, unit_price
          FROM item_variant_order
          WHERE order_id = ?
            AND qty > 0
        `).all(id);

        clearOrderAllocations(db, id);
        for (const item of existingItems) {
          allocateOrderItemAcrossBatches(db, {
            orderId: id,
            orderItemId: item.id,
            itemVariantId: item.item_variant_id,
            qty: item.qty,
            soldUnitPrice: parseOptionalNumber(item.unit_price, 0),
          });
        }
      }

      const result = db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
      if (result.changes === 0) {
        throw new Error('Order not found');
      }

      const completedCashAmount = calculateOrderCashImpact(order.total_amount, order.is_card_payment);
      let cashChange = 0;
      if (order.current_status !== 'completed' && status === 'completed') {
        cashChange = completedCashAmount;
      } else if (order.current_status === 'completed' && status !== 'completed') {
        cashChange = -completedCashAmount;
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
    if (err.message === 'Cancelled return orders cannot be reopened') {
      return res.status(400).json({ error: err.message });
    }
    if (err.message && err.message.startsWith('Insufficient stock')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// Update order items and details (non-return orders only)
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
    is_card_payment,
    items,
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
  const requestedDiscountValue = parseOptionalNumber(discount_value, 0);
  const requestedDiscountType = discount_type || null;
  const safeTenderCash = tender_cash === undefined ? null : parseOptionalNumber(tender_cash, 0);
  const safeIsCardPayment = is_card_payment === undefined ? null : (parseBoolean(is_card_payment, false) ? 1 : 0);

  let subtotal = 0;
  for (const item of normalizedItems) {
    subtotal += item.unit_price * item.qty;
  }

  const normalizedDiscount = normalizeOrderDiscountForGlobalRules(db, {
    subtotal,
    discountType: requestedDiscountType,
    discountValue: requestedDiscountValue,
  });

  const discountAmount = normalizedDiscount.discountAmount;
  const totalAmount = subtotal + safeAdditionalCharges - discountAmount;

  try {
    const transaction = db.transaction(() => {
      const oldOrder = db.prepare(`
        SELECT total_amount as old_total, status as old_status, staff_id, tender_cash,
               COALESCE(is_return, 0) AS is_return, COALESCE(is_card_payment, 0) AS old_is_card_payment
        FROM orders
        WHERE id = ?
      `).get(id);

      if (!oldOrder) {
        throw new Error('Order not found');
      }

      if (oldOrder.is_return) {
        throw new Error('Return orders cannot be edited after creation');
      }

      const resolvedStatus = status || oldOrder.old_status;
      const resolvedStaffId = staff_id || oldOrder.staff_id;
      const resolvedTenderCash = safeTenderCash === null ? oldOrder.tender_cash : safeTenderCash;
      const resolvedIsCardPayment = safeIsCardPayment === null ? oldOrder.old_is_card_payment : safeIsCardPayment;

      const updateResult = db.prepare(`
        UPDATE orders
        SET staff_id = ?, additional_charges = ?, total_amount = ?,
            customer_name = ?, discount_type = ?, discount_value = ?, status = ?, tender_cash = ?, is_card_payment = ?
        WHERE id = ?
      `).run(
        resolvedStaffId,
        safeAdditionalCharges,
        totalAmount,
        customer_name,
        normalizedDiscount.discountType,
        normalizedDiscount.discountValue,
        resolvedStatus,
        resolvedTenderCash,
        resolvedIsCardPayment,
        id
      );

      if (updateResult.changes === 0) {
        throw new Error('Order not found');
      }

      if (oldOrder.old_status !== 'cancelled') {
        restoreOrderStock(db, id);
      } else {
        clearOrderAllocations(db, id);
      }

      db.prepare('DELETE FROM item_variant_order WHERE order_id = ?').run(id);

      const insertItem = db.prepare(`
        INSERT INTO item_variant_order (
          item_variant_id,
          order_id,
          qty,
          unit_price,
          discount_source,
          discount_type,
          discount_value,
          discount_amount,
          original_price
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of normalizedItems) {
        const itemResult = insertItem.run(
          item.item_variant_id,
          id,
          item.qty,
          item.unit_price,
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

      const oldCompletedCash = oldOrder.old_status === 'completed'
        ? calculateOrderCashImpact(oldOrder.old_total, oldOrder.old_is_card_payment)
        : 0;
      const newCompletedCash = resolvedStatus === 'completed'
        ? calculateOrderCashImpact(totalAmount, resolvedIsCardPayment)
        : 0;

      if (resolvedStaffId === oldOrder.staff_id) {
        const cashChange = newCompletedCash - oldCompletedCash;
        if (cashChange !== 0) {
          db.prepare(`
            UPDATE cashier_shift
            SET current_cash_onhand = current_cash_onhand + ?
            WHERE staff_id = ? AND status = 'open'
          `).run(cashChange, resolvedStaffId);
        }
      } else {
        if (oldCompletedCash !== 0) {
          db.prepare(`
            UPDATE cashier_shift
            SET current_cash_onhand = current_cash_onhand - ?
            WHERE staff_id = ? AND status = 'open'
          `).run(oldCompletedCash, oldOrder.staff_id);
        }
        if (newCompletedCash !== 0) {
          db.prepare(`
            UPDATE cashier_shift
            SET current_cash_onhand = current_cash_onhand + ?
            WHERE staff_id = ? AND status = 'open'
          `).run(newCompletedCash, resolvedStaffId);
        }
      }

      return { id, total_amount: totalAmount };
    });

    const result = transaction();
    res.json({
      id: result.id,
      total_amount: result.total_amount,
      message: 'Order updated successfully',
    });
  } catch (err) {
    if (err.message === 'Order not found') {
      return res.status(404).json({ error: err.message });
    }
    if (err.message === 'Return orders cannot be edited after creation') {
      return res.status(400).json({ error: err.message });
    }
    if (err.message && err.message.startsWith('Insufficient stock')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;