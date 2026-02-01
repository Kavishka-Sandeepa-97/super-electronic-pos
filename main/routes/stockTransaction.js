const express = require('express');
const router = express.Router();
const { getDatabase, getCurrentUTCTimestamp } = require('../database/init');

// Get all transactions with product and supplier info
router.get('/', (req, res) => {
  const db = getDatabase();
  const { type, from_date, to_date, product_id } = req.query;
  
  let query = `
    SELECT 
      st.*,
      sp.name as product_name,
      ss.name as supplier_name,
      u.name as user_name,
      sc.name as category_name,
      un.name as unit_name
    FROM stock_transaction st
    LEFT JOIN stock_product sp ON st.product_id = sp.id
    LEFT JOIN stock_supplier ss ON st.supplier_id = ss.id
    LEFT JOIN staff u ON st.user_id = u.id
    LEFT JOIN stock_category sc ON sp.category_id = sc.id
    LEFT JOIN unit un ON sp.unit_id = un.id
    WHERE 1=1
  `;
  
  const params = [];
  
  if (type && type !== 'ALL') {
    query += ' AND st.type = ?';
    params.push(type);
  }
  
  if (from_date) {
    query += ' AND DATE(st.created_at) >= DATE(?)';
    params.push(from_date);
  }
  
  if (to_date) {
    query += ' AND DATE(st.created_at) <= DATE(?)';
    params.push(to_date);
  }
  
  if (product_id) {
    query += ' AND st.product_id = ?';
    params.push(product_id);
  }
  
  query += ' ORDER BY st.created_at DESC';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Get transaction by ID
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  db.get(
    `SELECT 
      st.*,
      sp.name as product_name,
      ss.name as supplier_name,
      u.name as user_name
    FROM stock_transaction st
    LEFT JOIN stock_product sp ON st.product_id = sp.id
    LEFT JOIN stock_supplier ss ON st.supplier_id = ss.id
    LEFT JOIN staff u ON st.user_id = u.id
    WHERE st.id = ?`,
    [id],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: 'Transaction not found' });
      }
      res.json(row);
    }
  );
});

// Create new transaction
router.post('/', (req, res) => {
  const db = getDatabase();
  const { product_id, supplier_id, type, qty, price, description, user_id } = req.body;
  
  // Validate required fields
  if (!product_id || !type || !qty || !user_id) {
    return res.status(400).json({ 
      error: 'Product, type, quantity, and user are required' 
    });
  }
  
  // Validate type
  if (!['IN', 'OUT'].includes(type)) {
    return res.status(400).json({ 
      error: 'Type must be either IN or OUT' 
    });
  }
  
  // Validate quantity is positive
  if (parseFloat(qty) <= 0) {
    return res.status(400).json({ 
      error: 'Quantity must be greater than 0' 
    });
  }
  
  // For IN transactions, price is required
  if (type === 'IN' && !price) {
    return res.status(400).json({ 
      error: 'Price is required for IN transactions' 
    });
  }
  
  // For IN transactions, validate price is positive
  if (type === 'IN' && parseFloat(price) <= 0) {
    return res.status(400).json({ 
      error: 'Price must be greater than 0' 
    });
  }
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    // Insert transaction
    db.run(
      `INSERT INTO stock_transaction 
       (product_id, supplier_id, type, qty, price, description, user_id, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [product_id, supplier_id || null, type, qty, price || null, description || null, user_id, getCurrentUTCTimestamp()],
      function(err) {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: err.message });
        }
        
        const transactionId = this.lastID;
        
        // Update product quantity
        const qtyChange = type === 'IN' ? parseFloat(qty) : -parseFloat(qty);
        
        db.run(
          'UPDATE stock_product SET current_qty = current_qty + ? WHERE id = ?',
          [qtyChange, product_id],
          function(err) {
            if (err) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: err.message });
            }
            
            // Check if quantity is negative after OUT transaction
            db.get(
              'SELECT current_qty FROM stock_product WHERE id = ?',
              [product_id],
              (err, row) => {
                if (err) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: err.message });
                }
                
                if (row.current_qty < 0) {
                  db.run('ROLLBACK');
                  return res.status(400).json({ 
                    error: 'Insufficient stock. Cannot complete OUT transaction.' 
                  });
                }
                
                db.run('COMMIT');
                res.status(201).json({
                  id: transactionId,
                  message: 'Transaction created successfully',
                  new_qty: row.current_qty
                });
              }
            );
          }
        );
      }
    );
  });
});

// Update transaction
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { product_id, supplier_id, type, qty, price, description, user_id } = req.body;
  
  // Validate required fields
  if (!product_id || !type || !qty || !user_id) {
    return res.status(400).json({ 
      error: 'Product, type, quantity, and user are required' 
    });
  }
  
  // Validate type
  if (!['IN', 'OUT'].includes(type)) {
    return res.status(400).json({ 
      error: 'Type must be either IN or OUT' 
    });
  }
  
  // Validate quantity is positive
  if (parseFloat(qty) <= 0) {
    return res.status(400).json({ 
      error: 'Quantity must be greater than 0' 
    });
  }
  
  // For IN transactions, price is required
  if (type === 'IN' && !price) {
    return res.status(400).json({ 
      error: 'Price is required for IN transactions' 
    });
  }
  
  db.serialize(() => {
    // Get old transaction details first
    db.get('SELECT * FROM stock_transaction WHERE id = ?', [id], (err, oldTransaction) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      if (!oldTransaction) {
        return res.status(404).json({ error: 'Transaction not found' });
      }
      
      console.log('Old transaction:', oldTransaction);
      console.log('New data:', { product_id, supplier_id, type, qty, price, description, user_id });
      
      db.run('BEGIN TRANSACTION');
      
      // Reverse the old quantity change from the old product
      const oldQtyChange = oldTransaction.type === 'IN' ? -parseFloat(oldTransaction.qty) : parseFloat(oldTransaction.qty);
      
      db.run(
        'UPDATE stock_product SET current_qty = current_qty + ? WHERE id = ?',
        [oldQtyChange, oldTransaction.product_id],
        function(err) {
          if (err) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: err.message });
          }
          
          console.log('Reversed old qty change:', oldQtyChange, 'from product:', oldTransaction.product_id);
          
          // Update the transaction record
          db.run(
            `UPDATE stock_transaction 
             SET product_id = ?, supplier_id = ?, type = ?, qty = ?, price = ?, description = ?, user_id = ?
             WHERE id = ?`,
            [product_id, supplier_id || null, type, parseFloat(qty), price ? parseFloat(price) : null, description || null, user_id, id],
            function(err) {
              if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
              }
              
              console.log('Transaction record updated');
              
              // Apply the new quantity change to the new product
              const newQtyChange = type === 'IN' ? parseFloat(qty) : -parseFloat(qty);
              
              db.run(
                'UPDATE stock_product SET current_qty = current_qty + ? WHERE id = ?',
                [newQtyChange, product_id],
                function(err) {
                  if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: err.message });
                  }
                  
                  console.log('Applied new qty change:', newQtyChange, 'to product:', product_id);
                  
                  // Check if the new product quantity is negative
                  db.get(
                    'SELECT current_qty FROM stock_product WHERE id = ?',
                    [product_id],
                    (err, row) => {
                      if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: err.message });
                      }
                      
                      if (row.current_qty < 0) {
                        db.run('ROLLBACK');
                        return res.status(400).json({ 
                          error: 'Insufficient stock. Cannot complete update.' 
                        });
                      }
                      
                      // Also check the old product if it's different
                      if (oldTransaction.product_id !== product_id) {
                        db.get(
                          'SELECT current_qty FROM stock_product WHERE id = ?',
                          [oldTransaction.product_id],
                          (err, oldRow) => {
                            if (err) {
                              db.run('ROLLBACK');
                              return res.status(500).json({ error: err.message });
                            }
                            
                            if (oldRow.current_qty < 0) {
                              db.run('ROLLBACK');
                              return res.status(400).json({ 
                                error: 'Cannot update. Would result in negative stock for original product.' 
                              });
                            }
                            
                            db.run('COMMIT');
                            console.log('Transaction committed. New qty:', row.current_qty);
                            res.json({ 
                              message: 'Transaction updated successfully',
                              new_qty: row.current_qty
                            });
                          }
                        );
                      } else {
                        db.run('COMMIT');
                        console.log('Transaction committed. New qty:', row.current_qty);
                        res.json({ 
                          message: 'Transaction updated successfully',
                          new_qty: row.current_qty
                        });
                      }
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
});

// Delete transaction
router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  db.serialize(() => {
    // Get transaction details first
    db.get('SELECT * FROM stock_transaction WHERE id = ?', [id], (err, transaction) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      if (!transaction) {
        return res.status(404).json({ error: 'Transaction not found' });
      }
      
      db.run('BEGIN TRANSACTION');
      
      // Reverse the quantity change
      const qtyChange = transaction.type === 'IN' ? -parseFloat(transaction.qty) : parseFloat(transaction.qty);
      
      db.run(
        'UPDATE stock_product SET current_qty = current_qty + ? WHERE id = ?',
        [qtyChange, transaction.product_id],
        function(err) {
          if (err) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: err.message });
          }
          
          // Check if quantity becomes negative
          db.get(
            'SELECT current_qty FROM stock_product WHERE id = ?',
            [transaction.product_id],
            (err, row) => {
              if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: err.message });
              }
              
              if (row.current_qty < 0) {
                db.run('ROLLBACK');
                return res.status(400).json({ 
                  error: 'Cannot delete transaction. Would result in negative stock.' 
                });
              }
              
              // Delete the transaction
              db.run('DELETE FROM stock_transaction WHERE id = ?', [id], function(err) {
                if (err) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: err.message });
                }
                
                db.run('COMMIT');
                res.json({ 
                  message: 'Transaction deleted successfully',
                  new_qty: row.current_qty
                });
              });
            }
          );
        }
      );
    });
  });
});

module.exports = router;
