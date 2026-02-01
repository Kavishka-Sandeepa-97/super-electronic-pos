const express = require('express');
const router = express.Router();
const { getDatabase, getCurrentUTCTimestamp } = require('../database/init');

// Get all staff members
router.get('/', (req, res) => {
  const db = getDatabase();
  db.all('SELECT id, name, username, role, is_active, created_at FROM staff', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Get staff by ID
router.get('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  db.get('SELECT id, name, username, role, is_active, created_at FROM staff WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    res.json(row);
  });
});

// Create new staff member
router.post('/', (req, res) => {
  const db = getDatabase();
  const { name, username, pin, role } = req.body;
  
  if (!name || !username || !pin || !role) {
    return res.status(400).json({ error: 'Name, username, PIN, and role are required' });
  }
  
  if (pin.length < 4) {
    return res.status(400).json({ error: 'PIN must be at least 4 characters long' });
  }
  
  if (!['admin', 'cashier'].includes(role)) {
    return res.status(400).json({ error: 'Role must be either admin or cashier' });
  }
  
  // Check if username already exists
  db.get('SELECT id FROM staff WHERE username = ?', [username], (err, existingUser) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists. Please choose a different username.' });
    }
    
    db.run(
      'INSERT INTO staff (name, username, pin, role, created_at) VALUES (?, ?, ?, ?, ?)',
      [name, username, pin, role, getCurrentUTCTimestamp()],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json({
          id: this.lastID,
          name,
          username,
          role,
          is_active: true,
          message: 'User created successfully'
        });
      }
    );
  });
});

// Update staff member
router.put('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { name, username, pin, role, is_active } = req.body;
  
  let updateFields = [];
  let values = [];
  
  // Validate PIN length if provided
  if (pin && pin.length < 4) {
    return res.status(400).json({ error: 'PIN must be at least 4 characters long' });
  }
  
  // Validate role if provided
  if (role && !['admin', 'cashier'].includes(role)) {
    return res.status(400).json({ error: 'Role must be either admin or cashier' });
  }
  
  // Check if username is being updated and if it's unique
  const checkUsernameAndUpdate = () => {
    if (name) {
      updateFields.push('name = ?');
      values.push(name);
    }
    if (username) {
      updateFields.push('username = ?');
      values.push(username);
    }
    if (pin) {
      updateFields.push('pin = ?');
      values.push(pin);
    }
    if (role) {
      updateFields.push('role = ?');
      values.push(role);
    }
    if (typeof is_active === 'boolean') {
      updateFields.push('is_active = ?');
      values.push(is_active ? 1 : 0);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    values.push(id);
    
    db.run(
      `UPDATE staff SET ${updateFields.join(', ')} WHERE id = ?`,
      values,
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'User not found' });
        }
        res.json({ message: 'User updated successfully' });
      }
    );
  };
  
  // If username is being updated, check for uniqueness
  if (username) {
    db.get('SELECT id FROM staff WHERE username = ? AND id != ?', [username, id], (err, existingUser) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (existingUser) {
        return res.status(409).json({ error: 'Username already exists. Please choose a different username.' });
      }
      checkUsernameAndUpdate();
    });
  } else {
    checkUsernameAndUpdate();
  }
});

// Delete staff member
router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  
  db.run('DELETE FROM staff WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Staff member not found' });
    }
    res.json({ message: 'Staff member deleted successfully' });
  });
});

// Staff login
router.post('/login', (req, res) => {
  const db = getDatabase();
  const { username, pin } = req.body;
  
  if (!username || !pin) {
    return res.status(400).json({ error: 'Username and PIN are required' });
  }
  
  // Check username and PIN
  db.get(
    'SELECT id, name, username, role, is_active FROM staff WHERE username = ? AND pin = ?',
    [username, pin],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      if (!row) {
        // Check if username exists to provide specific error
        db.get('SELECT id, is_active FROM staff WHERE username = ?', [username], (err, userExists) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          
          if (!userExists) {
            return res.status(401).json({ error: 'Invalid username or PIN. Please check your credentials.' });
          } else if (userExists.is_active === 0) {
            return res.status(403).json({ error: 'Your account has been deactivated. Please contact an administrator.' });
          } else {
            return res.status(401).json({ error: 'Invalid username or PIN. Please check your credentials.' });
          }
        });
        return;
      }
      
      if (row.is_active === 0) {
        return res.status(403).json({ error: 'Your account has been deactivated. Please contact an administrator.' });
      }
      
      res.json({
        id: row.id,
        name: row.name,
        username: row.username,
        role: row.role,
        message: 'Login successful'
      });
    }
  );
});

// Update own PIN (for users to change their own PIN)
router.put('/me/pin', (req, res) => {
  const db = getDatabase();
  const { userId, currentPin, newPin } = req.body;
  
  if (!userId || !currentPin || !newPin) {
    return res.status(400).json({ error: 'User ID, current PIN, and new PIN are required' });
  }
  
  if (newPin.length < 4) {
    return res.status(400).json({ error: 'PIN must be at least 4 characters long' });
  }
  
  // Verify current PIN
  db.get('SELECT id, name FROM staff WHERE id = ? AND pin = ?', [userId, currentPin], (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (!user) {
      return res.status(401).json({ error: 'Current PIN is incorrect' });
    }
    
    // Update to new PIN
    db.run('UPDATE staff SET pin = ? WHERE id = ?', [newPin, userId], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      res.json({ message: 'PIN updated successfully' });
    });
  });
});

module.exports = router;