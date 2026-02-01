const express = require('express');
const router = express.Router();
const { getDatabase, getCurrentUTCTimestamp } = require('../database/init');

// Get all orders
router.get('/', (req, res) => {
  const db = getDatabase();
  const { status, date_from, date_to, page = 1, limit = 10 } = req.query;
  
  let query = `
    SELECT o.*, CASE WHEN s.name = 'Admin' THEN 'System' ELSE s.name END as staff_name 
    FROM orders o 
    JOIN staff s ON o.admin_id = s.id
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
  
  db.get(countQuery, params, (err, countResult) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    const total = countResult.total;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Add pagination to main query
    const paginatedQuery = query + ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);
    
    db.all(paginatedQuery, params, (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
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
    });
  });
});

// Get order by ID with items
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  // Get order details
  db.get(
    `SELECT o.*, CASE WHEN s.name = 'Admin' THEN 'System' ELSE s.name END as staff_name 
     FROM orders o 
     JOIN staff s ON o.admin_id = s.id 
     WHERE o.id = ?`,
    [id],
    (err, order) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!order) {
        return res.status(404).json({ error: 'Order not found' });
      }
      
      // Get order items
      db.all(
        `SELECT ivo.*, iv.barcode, i.name as item_name, v.variant_name, c.name as category
         FROM item_variant_order ivo
         JOIN item_variant iv ON ivo.item_variant_id = iv.id
         JOIN item i ON iv.item_id = i.id
         JOIN variant v ON iv.variant_id = v.id
         JOIN category c ON i.category_id = c.id
         WHERE ivo.order_id = ?`,
        [id],
        (err, items) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          
          res.json({
            ...order,
            items: items
          });
        }
      );
    }
  );
});

// Create new order
router.post('/', (req, res) => {
  const db = getDatabase();
  const { 
    admin_id, 
    additional_charges = 0, 
    customer_name, 
    tender_cash,
    discount_type,
    discount_value = 0,
    status = 'active',
    items 
  } = req.body;
  
  if (!admin_id || !items || items.length === 0) {
    return res.status(400).json({ error: 'Admin ID and items are required' });
  }

  if (!['active', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  // Calculate total amount
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
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    // Insert order
    db.run(
      `INSERT INTO orders (admin_id, date, additional_charges, total_amount, 
                          customer_name, tender_cash, discount_type, discount_value, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [admin_id, getCurrentUTCTimestamp(), additional_charges, total_amount, customer_name, 
       tender_cash, discount_type, discount_value, status],
      function(err) {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: err.message });
        }
        
        const orderId = this.lastID;
        let itemsProcessed = 0;
        let hasError = false;
        
        // Insert order items
        items.forEach(item => {
          db.run(
            'INSERT INTO item_variant_order (item_variant_id, order_id, qty, unit_price) VALUES (?, ?, ?, ?)',
            [item.item_variant_id, orderId, item.qty, item.unit_price],
            function(err) {
              if (err && !hasError) {
                hasError = true;
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
              }
              
              // Update stock using FIFO (First In, First Out)
              const deductStockFIFO = (itemVariantId, quantity, callback) => {
                      // Get batches ordered by creation date (oldest first)
                      db.all(
                        'SELECT id, remaining_qty FROM stock_batch WHERE item_variant_id = ? AND remaining_qty > 0 ORDER BY created_at ASC',
                        [itemVariantId],
                        (err, batches) => {
                          if (err) {
                            return callback(err);
                          }
                          
                          let remainingQty = quantity;
                          let batchIndex = 0;
                          
                          const processBatch = () => {
                            if (remainingQty <= 0 || batchIndex >= batches.length) {
                              if (remainingQty > 0) {
                                return callback(new Error('Insufficient stock'));
                              }
                              return callback(null);
                            }
                            
                            const batch = batches[batchIndex];
                            const deductQty = Math.min(remainingQty, batch.remaining_qty);
                            
                            db.run(
                              'UPDATE stock_batch SET remaining_qty = remaining_qty - ? WHERE id = ?',
                              [deductQty, batch.id],
                              (err) => {
                                if (err) {
                                  return callback(err);
                                }
                                
                                remainingQty -= deductQty;
                                batchIndex++;
                                processBatch();
                              }
                            );
                          };
                          
                          processBatch();
                        }
                      );
                    };
                    
                    // Deduct stock using FIFO
                    deductStockFIFO(item.item_variant_id, item.qty, (err) => {
                      if (err && !hasError) {
                        hasError = true;
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: err.message });
                      }
                      
                      itemsProcessed++;
                      if (itemsProcessed === items.length && !hasError) {
                        // Update cashier shift cash amount for completed orders
                        if (status === 'completed') {
                          db.run(
                            `UPDATE cashier_shift 
                             SET current_cash_onhand = current_cash_onhand + ? 
                             WHERE user_id = ? AND status = 'open'`,
                            [total_amount, admin_id],
                            (err) => {
                              if (err) {
                                console.error('Error updating cashier cash:', err);
                              }
                            }
                          );
                        }

                        db.run('COMMIT', (err) => {
                          if (err) {
                            return res.status(500).json({ error: err.message });
                          }
                          res.status(201).json({
                            id: orderId,
                            total_amount,
                            status,
                            message: 'Order created successfully'
                          });
                        });
                      }
                    });
            }
          );
        });
      }
    );
  });
});

// Update order status
router.put('/:id/status', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { status } = req.body;
  
  if (!['active', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  // If cancelling order, restore stock
  if (status === 'cancelled') {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Get order items
      db.all(
        'SELECT item_variant_id, qty FROM item_variant_order WHERE order_id = ?',
        [id],
        (err, items) => {
          if (err) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: err.message });
          }
          
          if (items.length === 0) {
            // No items to restore, just update status
            db.run(
              'UPDATE orders SET status = ? WHERE id = ?',
              [status, id],
              function(err) {
                if (err) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: err.message });
                }
                db.run('COMMIT');
                res.json({ message: 'Order status updated successfully' });
              }
            );
            return;
          }
          
          // Restore stock using LIFO (Last In, First Out) - reverse of FIFO
          let itemsProcessed = 0;
          let hasError = false;
          
          items.forEach(item => {
            // Get batches ordered by creation date (newest first for restoration)
            db.all(
              'SELECT id FROM stock_batch WHERE item_variant_id = ? ORDER BY created_at DESC',
              [item.item_variant_id],
              (err, batches) => {
                if (err && !hasError) {
                  hasError = true;
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: err.message });
                }
                
                let remainingQty = item.qty;
                let batchIndex = 0;
                
                const restoreBatch = () => {
                  if (remainingQty <= 0 || batchIndex >= batches.length) {
                    itemsProcessed++;
                    if (itemsProcessed === items.length && !hasError) {
                      // Update order status
                      db.run(
                        'UPDATE orders SET status = ? WHERE id = ?',
                        [status, id],
                        function(err) {
                          if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: err.message });
                          }
                          db.run('COMMIT');
                          res.json({ message: 'Order cancelled and stock restored successfully' });
                        }
                      );
                    }
                    return;
                  }
                  
                  const batch = batches[batchIndex];
                  
                  db.run(
                    'UPDATE stock_batch SET remaining_qty = remaining_qty + ? WHERE id = ?',
                    [remainingQty, batch.id],
                    (err) => {
                      if (err && !hasError) {
                        hasError = true;
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: err.message });
                      }
                      
                      remainingQty = 0; // All restored to this batch
                      batchIndex++;
                      restoreBatch();
                    }
                  );
                };
                
                restoreBatch();
              }
            );
          });
        }
      );
    });
  } else {
    // For other status updates, update the status and handle cash if completing
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // First get the order details for cash update
      db.get(
        'SELECT total_amount, admin_id, status as current_status FROM orders WHERE id = ?',
        [id],
        (err, order) => {
          if (err) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: err.message });
          }
          
          if (!order) {
            db.run('ROLLBACK');
            return res.status(404).json({ error: 'Order not found' });
          }
          
          // Update order status
          db.run(
            'UPDATE orders SET status = ? WHERE id = ?',
            [status, id],
            function(err) {
              if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
              }
              
              if (this.changes === 0) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Order not found' });
              }
              
              // If status changed to 'completed' and was not already completed, update cash
              if (status === 'completed' && order.current_status !== 'completed') {
                db.run(
                  `UPDATE cashier_shift 
                   SET current_cash_onhand = current_cash_onhand + ? 
                   WHERE user_id = ? AND status = 'open'`,
                  [order.total_amount, order.admin_id],
                  (err) => {
                    if (err) {
                      console.error('Error updating cashier cash:', err);
                      // Don't fail the status update for cash update error
                    }
                    
                    db.run('COMMIT', (err) => {
                      if (err) {
                        return res.status(500).json({ error: err.message });
                      }
                      res.json({ message: 'Order status updated successfully' });
                    });
                  }
                );
              } else {
                db.run('COMMIT', (err) => {
                  if (err) {
                    return res.status(500).json({ error: err.message });
                  }
                  res.json({ message: 'Order status updated successfully' });
                });
              }
            }
          );
        }
      );
    });
  }
});

// Update order items and details
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { 
    admin_id,
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
  
  // Get old order details for cash adjustment
  db.get('SELECT total_amount as old_total, status as old_status, admin_id FROM orders WHERE id = ?', [id], (err, oldOrder) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!oldOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Update order
      db.run(
        `UPDATE orders SET additional_charges = ?, total_amount = ?, 
                           customer_name = ?, discount_type = ?, discount_value = ?, status = ? 
         WHERE id = ?`,
        [additional_charges, total_amount, customer_name, 
         discount_type, discount_value, status, id],
        function(err) {
          if (err) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: err.message });
          }
          
          if (this.changes === 0) {
            db.run('ROLLBACK');
            return res.status(404).json({ error: 'Order not found' });
          }
        
        // Delete existing order items and handle stock restoration
        db.all(
          'SELECT item_variant_id, qty FROM item_variant_order WHERE order_id = ?',
          [id],
          (err, oldItems) => {
            if (err) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: err.message });
            }
            
            let restoreProcessed = 0;
            let restoreError = false;
            
            if (oldItems.length === 0) {
              // No old items, proceed to delete and insert
              proceedWithDelete();
            } else {
              oldItems.forEach(oldItem => {
                // Restore stock using LIFO (Last In, First Out)
                db.all(
                  'SELECT id FROM stock_batch WHERE item_variant_id = ? ORDER BY created_at DESC',
                  [oldItem.item_variant_id],
                  (err, batches) => {
                    if (err && !restoreError) {
                      restoreError = true;
                      db.run('ROLLBACK');
                      return res.status(500).json({ error: err.message });
                    }
                    
                    let remainingQty = oldItem.qty;
                    let batchIndex = 0;
                    
                    const restoreBatch = () => {
                      if (remainingQty <= 0 || batchIndex >= batches.length) {
                        restoreProcessed++;
                        if (restoreProcessed === oldItems.length && !restoreError) {
                          proceedWithDelete();
                        }
                        return;
                      }
                      
                      const batch = batches[batchIndex];
                      
                      db.run(
                        'UPDATE stock_batch SET remaining_qty = remaining_qty + ? WHERE id = ?',
                        [remainingQty, batch.id],
                        (err) => {
                          if (err && !restoreError) {
                            restoreError = true;
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: err.message });
                          }
                          
                          remainingQty = 0; // All restored to this batch
                          batchIndex++;
                          restoreBatch();
                        }
                      );
                    };
                    
                    restoreBatch();
                  }
                );
              });
            }
            
            function proceedWithDelete() {
              db.run(
                'DELETE FROM item_variant_order WHERE order_id = ?',
                [id],
                function(err) {
                  if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                  }
                  
                  let itemsProcessed = 0;
                  let hasError = false;
                  
                  // Insert new order items
                  items.forEach(item => {
                    db.run(
                      'INSERT INTO item_variant_order (item_variant_id, order_id, qty, unit_price) VALUES (?, ?, ?, ?)',
                      [item.item_variant_id, id, item.qty, item.unit_price],
                      function(err) {
                        if (err && !hasError) {
                          hasError = true;
                          db.run('ROLLBACK');
                          return res.status(500).json({ error: err.message });
                        }
                        
                        // Update stock using FIFO (First In, First Out)
                        const deductStockFIFO = (itemVariantId, quantity, callback) => {
                          // Get batches ordered by creation date (oldest first)
                          db.all(
                            'SELECT id, remaining_qty FROM stock_batch WHERE item_variant_id = ? AND remaining_qty > 0 ORDER BY created_at ASC',
                            [itemVariantId],
                            (err, batches) => {
                              if (err) {
                                return callback(err);
                              }
                              
                              let remainingQty = quantity;
                              let batchIndex = 0;
                              
                              const processBatch = () => {
                                if (remainingQty <= 0 || batchIndex >= batches.length) {
                                  if (remainingQty > 0) {
                                    return callback(new Error('Insufficient stock'));
                                  }
                                  return callback(null);
                                }
                                
                                const batch = batches[batchIndex];
                                const deductQty = Math.min(remainingQty, batch.remaining_qty);
                                
                                db.run(
                                  'UPDATE stock_batch SET remaining_qty = remaining_qty - ? WHERE id = ?',
                                  [deductQty, batch.id],
                                  (err) => {
                                    if (err) {
                                      return callback(err);
                                    }
                                    
                                    remainingQty -= deductQty;
                                    batchIndex++;
                                    processBatch();
                                  }
                                );
                              };
                              
                              processBatch();
                            }
                          );
                        };
                        
                        // Deduct stock using FIFO
                        deductStockFIFO(item.item_variant_id, item.qty, (err) => {
                          if (err && !hasError) {
                            hasError = true;
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: err.message });
                          }
                          
                          itemsProcessed++;
                          if (itemsProcessed === items.length && !hasError) {
                            db.run('COMMIT', (err) => {
                              if (err) {
                                return res.status(500).json({ error: err.message });
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
                                db.run(
                                  `UPDATE cashier_shift 
                                   SET current_cash_onhand = current_cash_onhand + ? 
                                   WHERE user_id = ? AND status = 'open'`,
                                  [cash_change, oldOrder.admin_id]
                                );
                              }
                              
                              res.json({
                                id: id,
                                total_amount,
                                message: 'Order updated successfully'
                              });
                            });
                          }
                        });
                      }
                    );
                  });
                }
              );
            }
          }
        );
      }
    );
  });
  });
});

// Get daily sales summary
router.get('/reports/daily', (req, res) => {
  const db = getDatabase();
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];
  
  db.get(
    `SELECT 
       COUNT(*) as total_orders,
       SUM(total_amount) as total_sales,
       SUM(additional_charges) as total_charges,
       SUM(discount_value) as total_discounts,
       AVG(total_amount) as average_order_value
     FROM orders 
     WHERE DATE(date) = ? AND status = 'completed'`,
    [targetDate],
    (err, summary) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      // Get top selling items
      db.all(
        `SELECT i.name as item_name, v.variant_name, 
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
         LIMIT 10`,
        [targetDate],
        (err, topItems) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          
          res.json({
            date: targetDate,
            summary: summary,
            top_items: topItems
          });
        }
      );
    }
  );
});

module.exports = router;