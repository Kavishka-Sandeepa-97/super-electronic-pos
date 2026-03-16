const express = require('express');
const router = express.Router();
const { getDatabase } = require('../database/init');

// Helper function to format date as YYYY-MM-DD in local time
const formatLocalDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper function to get date range based on period
const getDateRange = (period, startDate, endDate) => {
  const now = new Date();
  let start, end;

  if (startDate && endDate && startDate !== 'null' && endDate !== 'null') {
    // Parse dates as local time
    start = new Date(startDate + 'T00:00:00');
    end = new Date(endDate + 'T23:59:59');
  } else {
    switch (period) {
      case 'today':
        // For "today", we need to get the current date in local time
        // and adjust for timezone since database stores UTC
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        start = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)); // Start of day in UTC
        end = new Date(today.getTime() + (24 * 60 * 60 * 1000) - (today.getTimezoneOffset() * 60000) - 1000); // End of day in UTC
        break;
      case 'week':
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);
        start = new Date(weekStart.getTime() - (weekStart.getTimezoneOffset() * 60000));
        end = new Date(weekStart.getTime() + (7 * 24 * 60 * 60 * 1000) - (weekStart.getTimezoneOffset() * 60000) - 1000);
        break;
      case 'month':
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        start = new Date(monthStart.getTime() - (monthStart.getTimezoneOffset() * 60000));
        end = new Date(monthEnd.getTime() + (24 * 60 * 60 * 1000) - (monthEnd.getTimezoneOffset() * 60000) - 1000);
        break;
      case 'year':
        const yearStart = new Date(now.getFullYear(), 0, 1);
        const yearEnd = new Date(now.getFullYear(), 11, 31);
        start = new Date(yearStart.getTime() - (yearStart.getTimezoneOffset() * 60000));
        end = new Date(yearEnd.getTime() + (24 * 60 * 60 * 1000) - (yearEnd.getTimezoneOffset() * 60000) - 1000);
        break;
      default:
        // Last 30 days by default
        end = new Date(now.getTime() - (now.getTimezoneOffset() * 60000) + (24 * 60 * 60 * 1000) - 1000);
        start = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000) - (now.getTimezoneOffset() * 60000));
    }
  }

  // Ensure dates are valid
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('Invalid date range');
  }

  return {
    start: formatLocalDate(start),
    end: formatLocalDate(end)
  };
};

const completedSalesCte = `
  WITH completed_sales AS (
    SELECT
      iob.item_variant_id,
      iob.order_id,
      iob.qty,
      iob.sold_unit_price AS sold_unit_price,
      iob.batch_buy_price AS buy_unit_price
    FROM item_variant_order_batch iob
    JOIN orders o ON iob.order_id = o.id
    WHERE o.status = 'completed'
      AND DATE(o.date) >= ?
      AND DATE(o.date) <= ?

    UNION ALL

    SELECT
      ivo.item_variant_id,
      ivo.order_id,
      ivo.qty,
      ivo.unit_price AS sold_unit_price,
      COALESCE(
        (
          SELECT CASE
            WHEN SUM(sb.initial_qty) > 0 THEN SUM(sb.buy_price * sb.initial_qty) / SUM(sb.initial_qty)
            ELSE AVG(sb.buy_price)
          END
          FROM stock_batch sb
          WHERE sb.item_variant_id = ivo.item_variant_id
        ),
        0
      ) AS buy_unit_price
    FROM item_variant_order ivo
    JOIN orders o ON ivo.order_id = o.id
    WHERE o.status = 'completed'
      AND DATE(o.date) >= ?
      AND DATE(o.date) <= ?
      AND NOT EXISTS (
        SELECT 1
        FROM item_variant_order_batch iob2
        WHERE iob2.order_item_id = ivo.id
      )
  )
`;

// POS Reports

// Revenue report
router.get('/pos/revenue', (req, res) => {
  const db = getDatabase();
  const { period, start_date, end_date, group_by = 'day' } = req.query;

  const { start, end } = getDateRange(period, start_date, end_date);

  let groupFormat;
  switch (group_by) {
    case 'month':
      groupFormat = "strftime('%Y-%m', date)";
      break;
    case 'week':
      groupFormat = "strftime('%Y-%W', date)";
      break;
    case 'year':
      groupFormat = "strftime('%Y', date)";
      break;
    default:
      groupFormat = "strftime('%Y-%m-%d', date)";
  }

  try {
    const query = `
      SELECT
        ${groupFormat} as period,
        COUNT(*) as order_count,
        SUM(total_amount) as total_revenue,
        MIN(total_amount) as min_order,
        MAX(total_amount) as max_order
      FROM orders
      WHERE status = 'completed'
        AND DATE(date) >= ?
        AND DATE(date) <= ?
      GROUP BY ${groupFormat}
      ORDER BY period DESC
    `;

    const rows = db.prepare(query).all(start, end);
    res.json({ data: rows, dateRange: { start, end } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Top selling products
router.get('/pos/top-products', (req, res) => {
  const db = getDatabase();
  const { period, start_date, end_date, limit = 10 } = req.query;

  const { start, end } = getDateRange(period, start_date, end_date);

  try {
    const rows = db.prepare(`
      ${completedSalesCte}
      SELECT
        i.name as item_name,
        v.variant_name,
        iv.barcode,
        SUM(cs.qty) as total_quantity,
        ROUND(SUM(cs.qty * cs.sold_unit_price), 2) as total_revenue,
        ROUND(SUM(cs.qty * cs.buy_unit_price), 2) as total_cogs,
        ROUND(SUM(cs.qty * (cs.sold_unit_price - cs.buy_unit_price)), 2) as gross_profit,
        CASE
          WHEN SUM(cs.qty * cs.buy_unit_price) > 0
          THEN ROUND((SUM(cs.qty * (cs.sold_unit_price - cs.buy_unit_price)) / SUM(cs.qty * cs.buy_unit_price)) * 100, 2)
          ELSE 0
        END as margin_percent,
        COUNT(DISTINCT cs.order_id) as order_count
      FROM completed_sales cs
      JOIN item_variant iv ON cs.item_variant_id = iv.id
      JOIN item i ON iv.item_id = i.id
      JOIN variant v ON iv.variant_id = v.id
      GROUP BY iv.id
      ORDER BY total_quantity DESC
      LIMIT ?
    `).all(start, end, start, end, parseInt(limit));
    
    res.json({ data: rows, dateRange: { start, end } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Category sales report
router.get('/pos/category-sales', (req, res) => {
  const db = getDatabase();
  const { period, start_date, end_date } = req.query;

  const { start, end } = getDateRange(period, start_date, end_date);

  try {
    const rows = db.prepare(`
      ${completedSalesCte}
      SELECT
        c.name as category_name,
        COUNT(DISTINCT cs.order_id) as order_count,
        SUM(cs.qty) as total_quantity,
        ROUND(SUM(cs.qty * cs.sold_unit_price), 2) as total_revenue,
        ROUND(SUM(cs.qty * cs.buy_unit_price), 2) as total_cogs,
        ROUND(SUM(cs.qty * (cs.sold_unit_price - cs.buy_unit_price)), 2) as gross_profit,
        CASE
          WHEN SUM(cs.qty * cs.buy_unit_price) > 0
          THEN ROUND((SUM(cs.qty * (cs.sold_unit_price - cs.buy_unit_price)) / SUM(cs.qty * cs.buy_unit_price)) * 100, 2)
          ELSE 0
        END as margin_percent
      FROM completed_sales cs
      JOIN item_variant iv ON cs.item_variant_id = iv.id
      JOIN item i ON iv.item_id = i.id
      JOIN category c ON i.category_id = c.id
      GROUP BY c.id
      ORDER BY total_revenue DESC
    `).all(start, end, start, end);
    
    res.json({ data: rows, dateRange: { start, end } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stock Reports

// Stock transaction report
router.get('/stock/transactions', (req, res) => {
  const db = getDatabase();
  const { period, start_date, end_date, type, supplier_id } = req.query;

  const { start, end } = getDateRange(period, start_date, end_date);

  try {
    let query = `
      SELECT
        st.*,
        sp.name as product_name,
        sc.name as category_name,
        u.name as unit_name,
        ss.name as supplier_name,
        s.name as staff_name
      FROM stock_transaction st
      JOIN stock_product sp ON st.product_id = sp.id
      JOIN stock_category sc ON sp.category_id = sc.id
      JOIN unit u ON sp.unit_id = u.id
      LEFT JOIN stock_supplier ss ON st.supplier_id = ss.id
      JOIN staff s ON st.user_id = s.id
      WHERE DATE(st.created_at) >= ?
        AND DATE(st.created_at) <= ?
    `;

    const params = [start, end];

    if (type) {
      query += ' AND st.type = ?';
      params.push(type);
    }

    if (supplier_id) {
      query += ' AND st.supplier_id = ?';
      params.push(supplier_id);
    }

    query += ' ORDER BY st.created_at DESC';

    const rows = db.prepare(query).all(...params);
    res.json({ data: rows, dateRange: { start, end } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Current stock levels
router.get('/stock/levels', (req, res) => {
  const db = getDatabase();

  try {
    const rows = db.prepare(`
      SELECT
        sp.*,
        sc.name as category_name,
        u.name as unit_name
      FROM stock_product sp
      JOIN stock_category sc ON sp.category_id = sc.id
      JOIN unit u ON sp.unit_id = u.id
      ORDER BY sp.name
    `).all();
    
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Low stock report
router.get('/stock/low-stock', (req, res) => {
  const db = getDatabase();
  const { threshold = 10 } = req.query;

  try {
    const rows = db.prepare(`
      SELECT
        sp.*,
        sc.name as category_name,
        u.name as unit_name
      FROM stock_product sp
      JOIN stock_category sc ON sp.category_id = sc.id
      JOIN unit u ON sp.unit_id = u.id
      WHERE sp.current_qty <= ?
      ORDER BY sp.current_qty ASC
    `).all(parseFloat(threshold));
    
    res.json({ data: rows, threshold });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Supplier purchase report
router.get('/stock/supplier-purchases', (req, res) => {
  const db = getDatabase();
  const { period, start_date, end_date } = req.query;

  const { start, end } = getDateRange(period, start_date, end_date);

  try {
    const rows = db.prepare(`
      SELECT
        ss.id as supplier_id,
        ss.name as supplier_name,
        COALESCE(COUNT(st.id), 0) as transaction_count,
        COALESCE(SUM(st.qty), 0) as total_quantity,
        COALESCE(SUM(st.price * st.qty), 0) as total_amount
      FROM stock_supplier ss
      LEFT JOIN stock_transaction st ON ss.id = st.supplier_id 
        AND st.type = 'IN'
        AND DATE(st.created_at) >= ?
        AND DATE(st.created_at) <= ?
      GROUP BY ss.id, ss.name
      ORDER BY total_amount DESC
    `).all(start, end);
    
    res.json({ data: rows, dateRange: { start, end } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Inventory Valuation Report - Current stock value, investment, and potential profit
router.get('/stock/valuation', (req, res) => {
  const db = getDatabase();
  const { period, start_date, end_date } = req.query;

  let stockBatchFilter = '';
  let params = [];
  let dateRange = null;
  
  // Add date filtering for stock batches only if period is specified and not "all"
  if ((period && period !== 'all') || (start_date && end_date)) {
    const { start, end } = getDateRange(period, start_date, end_date);
    stockBatchFilter = 'AND DATE(sb.created_at) >= ? AND DATE(sb.created_at) <= ?';
    params = [start, end];
    dateRange = { start, end };
  }

  try {

    const rows = db.prepare(`
      SELECT 
        i.name as item_name,
        v.variant_name,
        c.name as category_name,
        b.brand_name,
        iv.barcode,
        
        -- Stock Information
        COALESCE(SUM(sb.remaining_qty), 0) as current_stock,
        COALESCE(SUM(sb.initial_qty), 0) as total_purchased,
        
        -- Cost Analysis
        CASE 
          WHEN SUM(sb.remaining_qty) > 0 
          THEN ROUND(SUM(sb.buy_price * sb.remaining_qty) / SUM(sb.remaining_qty), 2)
          ELSE COALESCE(AVG(sb.buy_price), 0)
        END as avg_buy_price,
        
        ROUND(COALESCE(SUM(sb.buy_price * sb.remaining_qty), 0), 2) as total_cost_investment,
        
        -- Selling Information  
        CASE 
          WHEN SUM(sb.remaining_qty) > 0 
          THEN ROUND(SUM(COALESCE(sb.sell_price, 0) * sb.remaining_qty) / SUM(sb.remaining_qty), 2)
          ELSE COALESCE(AVG(sb.sell_price), 0)
        END as current_selling_price,
        ROUND(COALESCE(SUM(COALESCE(sb.sell_price, 0) * sb.remaining_qty), 0), 2) as potential_revenue,
        
        -- Profit Analysis
        ROUND(
          COALESCE(SUM((COALESCE(sb.sell_price, 0) - sb.buy_price) * sb.remaining_qty), 0), 2
        ) as potential_profit,
        
        CASE 
          WHEN SUM(sb.buy_price * sb.remaining_qty) > 0 
          THEN ROUND(
            (COALESCE(SUM((COALESCE(sb.sell_price, 0) - sb.buy_price) * sb.remaining_qty), 0) / 
             COALESCE(SUM(sb.buy_price * sb.remaining_qty), 1)) * 100, 2
          )
          ELSE 0
        END as profit_margin_percent,
        
        -- Last Updated
        MAX(sb.created_at) as last_stock_update,
        MAX(COALESCE(sb.updated_at, sb.created_at)) as price_last_updated
        
      FROM item i
      JOIN item_variant iv ON i.id = iv.item_id
      JOIN variant v ON iv.variant_id = v.id
      JOIN category c ON i.category_id = c.id
      LEFT JOIN brand b ON i.brand_id = b.id
      LEFT JOIN stock_batch sb ON iv.id = sb.item_variant_id ${stockBatchFilter}
      
      GROUP BY iv.id, i.name, v.variant_name, c.name, b.brand_name, iv.barcode
      HAVING current_stock > 0  -- Only items with stock
      ORDER BY iv.created_at DESC
    `).all(...params);

    // Summary cards are calculated directly from batches (remaining_qty weighted),
    // so total investment strictly follows batch-wise cost.
    const summaryRow = db.prepare(`
      SELECT
        COUNT(DISTINCT iv.id) as total_items,
        COALESCE(SUM(sb.remaining_qty), 0) as total_stock_units,
        ROUND(COALESCE(SUM(sb.buy_price * sb.remaining_qty), 0), 2) as total_investment,
        ROUND(COALESCE(SUM(COALESCE(sb.sell_price, 0) * sb.remaining_qty), 0), 2) as total_potential_revenue,
        ROUND(COALESCE(SUM((COALESCE(sb.sell_price, 0) - sb.buy_price) * sb.remaining_qty), 0), 2) as total_potential_profit
      FROM item_variant iv
      LEFT JOIN stock_batch sb ON iv.id = sb.item_variant_id ${stockBatchFilter}
      WHERE COALESCE(sb.remaining_qty, 0) > 0
    `).get(...params);

    const toAmount = (value) => Number(Number(value || 0).toFixed(2));

    const summary = {
      total_items: Number(summaryRow?.total_items || 0),
      total_stock_units: Number(summaryRow?.total_stock_units || 0),
      total_investment: toAmount(summaryRow?.total_investment),
      total_potential_revenue: toAmount(summaryRow?.total_potential_revenue),
      total_potential_profit: toAmount(summaryRow?.total_potential_profit),
      overall_profit_margin: 0,
    };

    if (summary.total_investment > 0) {
      summary.overall_profit_margin = Number(
        ((summary.total_potential_profit / summary.total_investment) * 100).toFixed(2)
      );
    }

    res.json({ 
      data: rows, 
      summary: summary,
      dateRange: dateRange,
      generated_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Inventory valuation report error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;