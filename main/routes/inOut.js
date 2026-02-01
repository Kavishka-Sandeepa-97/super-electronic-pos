const express = require('express');
const router = express.Router();
const { getDatabase, getCurrentUTCTimestamp } = require('../database/init');

// Get all in/out transactions
router.get('/', (req, res) => {
  const db = getDatabase();
  const { page = 1, limit = 50, type, start_date, end_date } = req.query;

  let query = `
    SELECT io.*, s.name as staff_name
    FROM in_out io
    LEFT JOIN staff s ON io.staff_id = s.id
  `;
  let conditions = [];
  let params = [];

  if (type && ['IN', 'OUT'].includes(type.toUpperCase())) {
    conditions.push('io.type = ?');
    params.push(type.toUpperCase());
  }

  if (start_date) {
    conditions.push('DATE(io.created_at) >= ?');
    params.push(start_date);
  }

  if (end_date) {
    conditions.push('DATE(io.created_at) <= ?');
    params.push(end_date);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY io.created_at DESC';

  // Add pagination
  const offset = (parseInt(page) - 1) * parseInt(limit);
  query += ' LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM in_out io';
    if (conditions.length > 0) {
      countQuery += ' WHERE ' + conditions.join(' AND ');
    }

    db.get(countQuery, params.slice(0, -2), (err, countResult) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      res.json({
        data: rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: countResult.total,
          pages: Math.ceil(countResult.total / parseInt(limit))
        }
      });
    });
  });
});

// Get in/out transaction by ID
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;

  db.get(`
    SELECT io.*, s.name as staff_name
    FROM in_out io
    LEFT JOIN staff s ON io.staff_id = s.id
    WHERE io.id = ?
  `, [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json(row);
  });
});

// Create new in/out transaction
router.post('/', (req, res) => {
  const db = getDatabase();
  const { type, description, amount, staff_id } = req.body;

  if (!type || !description || !amount || !staff_id) {
    return res.status(400).json({ error: 'Type, description, amount, and staff_id are required' });
  }

  if (!['IN', 'OUT'].includes(type.toUpperCase())) {
    return res.status(400).json({ error: 'Type must be either IN or OUT' });
  }

  if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }

  // Verify staff exists
  db.get('SELECT id FROM staff WHERE id = ? AND is_active = 1', [staff_id], (err, staff) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!staff) {
      return res.status(400).json({ error: 'Invalid or inactive staff member' });
    }

    db.run(
      'INSERT INTO in_out (type, description, amount, staff_id, created_at) VALUES (?, ?, ?, ?, ?)',
      [type.toUpperCase(), description, parseFloat(amount), staff_id, getCurrentUTCTimestamp()],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        // Update cashier shift cash amount
        const cashAdjustment = type.toUpperCase() === 'IN' ? parseFloat(amount) : -parseFloat(amount);
        db.run(
          `UPDATE cashier_shift 
           SET current_cash_onhand = current_cash_onhand + ? 
           WHERE user_id = ? AND status = 'open'`,
          [cashAdjustment, staff_id],
          (err) => {
            if (err) {
              console.error('Error updating cashier cash:', err);
              // Don't fail the transaction for cash update error
            }
          }
        );

        res.status(201).json({
          id: this.lastID,
          type: type.toUpperCase(),
          description,
          amount: parseFloat(amount),
          staff_id,
          created_at: new Date().toISOString()
        });
      }
    );
  });
});

// Update in/out transaction
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { type, description, amount, staff_id } = req.body;

  // First get the current transaction details to reverse the old cash impact
  db.get('SELECT type, amount, staff_id FROM in_out WHERE id = ?', [id], (err, oldTransaction) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!oldTransaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    let updateFields = [];
    let values = [];

    if (type && ['IN', 'OUT'].includes(type.toUpperCase())) {
      updateFields.push('type = ?');
      values.push(type.toUpperCase());
    }

    if (description) {
      updateFields.push('description = ?');
      values.push(description);
    }

    if (amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0) {
      updateFields.push('amount = ?');
      values.push(parseFloat(amount));
    }

    if (staff_id) {
      // Verify staff exists
      db.get('SELECT id FROM staff WHERE id = ? AND is_active = 1', [staff_id], (err, staff) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        if (!staff) {
          return res.status(400).json({ error: 'Invalid or inactive staff member' });
        }

        updateFields.push('staff_id = ?');
        values.push(staff_id);

        if (updateFields.length === 0) {
          return res.status(400).json({ error: 'No valid fields to update' });
        }

        values.push(id);

        db.run(
          `UPDATE in_out SET ${updateFields.join(', ')} WHERE id = ?`,
          values,
          function(err) {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
              return res.status(404).json({ error: 'Transaction not found' });
            }

            // Reverse old cash impact
            const oldCashAdjustment = oldTransaction.type === 'IN' ? -parseFloat(oldTransaction.amount) : parseFloat(oldTransaction.amount);
            
            // Get new transaction details for new cash impact
            const newType = type ? type.toUpperCase() : oldTransaction.type;
            const newAmount = amount ? parseFloat(amount) : oldTransaction.amount;
            const newStaffId = staff_id || oldTransaction.staff_id;
            
            const newCashAdjustment = newType === 'IN' ? parseFloat(newAmount) : -parseFloat(newAmount);

            // Update cashier shift cash amount (reverse old + apply new)
            const totalCashAdjustment = oldCashAdjustment + newCashAdjustment;
            
            db.run(
              `UPDATE cashier_shift 
               SET current_cash_onhand = current_cash_onhand + ? 
               WHERE user_id = ? AND status = 'open'`,
              [totalCashAdjustment, newStaffId],
              (err) => {
                if (err) {
                  console.error('Error updating cashier cash on update:', err);
                  // Don't fail the update for cash update error
                }
              }
            );

            res.json({ message: 'Transaction updated successfully' });
          }
        );
      });
      return;
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(id);

    db.run(
      `UPDATE in_out SET ${updateFields.join(', ')} WHERE id = ?`,
      values,
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Transaction not found' });
        }

        // Reverse old cash impact
        const oldCashAdjustment = oldTransaction.type === 'IN' ? -parseFloat(oldTransaction.amount) : parseFloat(oldTransaction.amount);
        
        // Get new transaction details for new cash impact
        const newType = type ? type.toUpperCase() : oldTransaction.type;
        const newAmount = amount ? parseFloat(amount) : oldTransaction.amount;
        const newStaffId = oldTransaction.staff_id;
        
        const newCashAdjustment = newType === 'IN' ? parseFloat(newAmount) : -parseFloat(newAmount);

        // Update cashier shift cash amount (reverse old + apply new)
        const totalCashAdjustment = oldCashAdjustment + newCashAdjustment;
        
        db.run(
          `UPDATE cashier_shift 
           SET current_cash_onhand = current_cash_onhand + ? 
           WHERE user_id = ? AND status = 'open'`,
          [totalCashAdjustment, newStaffId],
          (err) => {
            if (err) {
              console.error('Error updating cashier cash on update:', err);
              // Don't fail the update for cash update error
            }
          }
        );

        res.json({ message: 'Transaction updated successfully' });
      }
    );
  });
});

// Delete in/out transaction
router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;

  // First get the transaction details to reverse the cash impact
  db.get('SELECT type, amount, staff_id FROM in_out WHERE id = ?', [id], (err, transaction) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Reverse the cash impact
    const cashAdjustment = transaction.type === 'IN' ? -parseFloat(transaction.amount) : parseFloat(transaction.amount);
    
    db.run('DELETE FROM in_out WHERE id = ?', [id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      // Update cashier shift cash amount (reverse the transaction)
      db.run(
        `UPDATE cashier_shift 
         SET current_cash_onhand = current_cash_onhand + ? 
         WHERE user_id = ? AND status = 'open'`,
        [cashAdjustment, transaction.staff_id],
        (err) => {
          if (err) {
            console.error('Error updating cashier cash on delete:', err);
            // Don't fail the delete for cash update error
          }
        }
      );

      res.json({ message: 'Transaction deleted successfully' });
    });
  });
});

// Get summary statistics
router.get('/summary/stats', (req, res) => {
  const db = getDatabase();
  const { start_date, end_date } = req.query;

  let dateCondition = '';
  let params = [];

  if (start_date && end_date) {
    dateCondition = 'AND DATE(created_at) BETWEEN ? AND ?';
    params = [start_date, end_date];
  } else if (start_date) {
    dateCondition = 'AND DATE(created_at) >= ?';
    params = [start_date];
  } else if (end_date) {
    dateCondition = 'AND DATE(created_at) <= ?';
    params = [end_date];
  }

  const query = `
    SELECT
      type,
      COUNT(*) as count,
      SUM(amount) as total_amount
    FROM in_out
    WHERE 1=1 ${dateCondition}
    GROUP BY type
  `;

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const stats = {
      IN: { count: 0, total_amount: 0 },
      OUT: { count: 0, total_amount: 0 }
    };

    rows.forEach(row => {
      stats[row.type] = {
        count: row.count,
        total_amount: parseFloat(row.total_amount) || 0
      };
    });

    stats.net_amount = stats.IN.total_amount - stats.OUT.total_amount;

    res.json(stats);
  });
});

module.exports = router;