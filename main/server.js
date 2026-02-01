const express = require('express');
const cors = require('cors');
const path = require('path');
const { app } = require('electron');
const multer = require('multer'); // Import multer
const compression = require('compression'); // Add compression

// Import routes
const staffRoutes = require('./routes/staff');
const categoryRoutes = require('./routes/category');
const itemRoutes = require('./routes/item');
const variantRoutes = require('./routes/variant');
const itemVariantRoutes = require('./routes/itemVariant');
const orderRoutes = require('./routes/order');
const stockRoutes = require('./routes/stock');
const stockUnitRoutes = require('./routes/stockUnit');
const stockCategoryRoutes = require('./routes/stockCategory');
const stockSupplierRoutes = require('./routes/stockSupplier');
const stockProductRoutes = require('./routes/stockProduct');
const stockTransactionRoutes = require('./routes/stockTransaction');
const inOutRoutes = require('./routes/inOut');
const cashierShiftRoutes = require('./routes/cashierShift');
const reportsRoutes = require('./routes/reports');

// Import database initialization
const { initializeDatabase } = require('./database/init');
const { getDatabase, getCurrentUTCTimestamp } = require('./database/init'); // Import getDatabase

const server = express();

// Configure Multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(app.getPath('userData'), 'uploads');
    require('fs').mkdirSync(uploadPath, { recursive: true }); // Ensure directory exists
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  },
});
// Add file size limit (5MB max) and file filter
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif|webp)$/)) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
});

// Middleware
server.use(compression()); // Enable gzip compression
server.use(cors());
server.use(express.json({ limit: '10mb' })); // Limit JSON payload size
server.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request timeout middleware (30 seconds)
server.use((req, res, next) => {
  req.setTimeout(30000); // 30 seconds
  res.setTimeout(30000);
  next();
});

// Serve static images
server.use('/uploads', express.static(path.join(app.getPath('userData'), 'uploads')));

// Initialize database
initializeDatabase();

// Routes
server.use('/api/staff', staffRoutes);
server.use('/api/categories', categoryRoutes);
server.use('/api/items', itemRoutes);
server.use('/api/variants', variantRoutes);
server.use('/api/item-variants', itemVariantRoutes);
server.use('/api/orders', orderRoutes);
server.use('/api/in-out', inOutRoutes);
server.use('/api/cashier-shifts', cashierShiftRoutes);
// Stock management routes - must be before '/api/stock'
server.use('/api/stock/units', stockUnitRoutes);
server.use('/api/stock/categories', stockCategoryRoutes);
server.use('/api/stock/suppliers', stockSupplierRoutes);
server.use('/api/stock/products', stockProductRoutes);
server.use('/api/stock/transactions', stockTransactionRoutes);
// General stock route
server.use('/api/stock', stockRoutes);

// Reports routes
server.use('/api/reports', reportsRoutes);

// New route for creating item with variant and image
server.post('/api/item-variants/create-full', upload.single('image'), async (req, res) => {
  const db = getDatabase();
  const { name, category, variant, barcode, sellingPrice, buyingPrice, initialQuantity, description } = req.body;
  const imagePath = req.file ? req.file.path : null;

  if (!name || !category || !variant || !sellingPrice || !initialQuantity) {
    return res.status(400).json({ error: 'Missing required fields: name, category, variant, sellingPrice, initialQuantity' });
  }

  db.serialize(async () => {
    db.run('BEGIN TRANSACTION');
    try {
      // 1. Get category_id
      const categoryRow = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM category WHERE name = ?', [category], (err, row) => {
          if (err) reject(err); else resolve(row);
        });
      });

      if (!categoryRow) {
        throw new Error('Category not found');
      }
      const category_id = categoryRow.id;

      // 2. Insert into item table
      const item_id = await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO item (category_id, name, image, created_at) VALUES (?, ?, ?, ?)',
          [category_id, name, imagePath, getCurrentUTCTimestamp()],
          function (err) {
            if (err) reject(err); else resolve(this.lastID);
          }
        );
      });

      // 3. Get or create variant_id
      let variant_id;
      const variantRow = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM variant WHERE variant_name = ?', [variant], (err, row) => {
          if (err) reject(err); else resolve(row);
        });
      });

      if (variantRow) {
        variant_id = variantRow.id;
      } else {
        variant_id = await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO variant (variant_name, created_at) VALUES (?, ?)',
            [variant, getCurrentUTCTimestamp()],
            function (err) {
              if (err) reject(err); else resolve(this.lastID);
            }
          );
        });
      }

      // 4. Insert into item_variant table
      const item_variant_id = await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO item_variant (variant_id, item_id, barcode, created_at) VALUES (?, ?, ?, ?)',
          [variant_id, item_id, barcode, getCurrentUTCTimestamp()],
          function (err) {
            if (err) {
              if (err.message.includes('UNIQUE constraint failed: item_variant.barcode')) {
                reject(new Error('Barcode already exists. Please use a different barcode.'));
              } else {
                reject(err);
              }
            } else {
              resolve(this.lastID);
            }
          }
        );
      });

      // 5. Insert into stock_batch with description
      const stock_batch_id = await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO stock_batch (item_variant_id, initial_qty, remaining_qty, buy_price, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [item_variant_id, parseInt(initialQuantity), parseInt(initialQuantity), parseFloat(buyingPrice || 0), description || null, getCurrentUTCTimestamp()],
          function (err) {
            if (err) reject(err); else resolve(this.lastID);
          }
        );
      });

      // 6. Insert into sell_price_history with stock_batch_id reference
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO sell_price_history (item_variant_id, user_id, selling_price, stock_batch_id, created_at) VALUES (?, ?, ?, ?, ?)',
          [item_variant_id, 1, parseFloat(sellingPrice), stock_batch_id, getCurrentUTCTimestamp()], // Using admin user_id = 1 as default
          function (err) {
            if (err) reject(err); else resolve();
          }
        );
      });

      db.run('COMMIT');
      res.status(201).json({ message: 'Item, variant, and stock created successfully', item_variant_id });

    } catch (error) {
      db.run('ROLLBACK');
      console.error('Transaction failed:', error.message);
      res.status(500).json({ error: error.message });
    }
  });
});

// New route for creating item with multiple variants
server.post('/api/items/create-with-variants', upload.single('image'), async (req, res) => {
  const db = getDatabase();
  const { name, category } = req.body;
  const variants = JSON.parse(req.body.variants || '[]');
  const imagePath = req.file ? req.file.path : null;

  if (!name || !category || !variants || variants.length === 0) {
    return res.status(400).json({ error: 'Missing required fields: name, category, variants array' });
  }

  db.serialize(async () => {
    db.run('BEGIN TRANSACTION');
    try {
      // 1. Get category_id
      const categoryRow = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM category WHERE name = ?', [category], (err, row) => {
          if (err) reject(err); else resolve(row);
        });
      });

      if (!categoryRow) {
        throw new Error('Category not found');
      }
      const category_id = categoryRow.id;

      // 2. Insert into item table
      const item_id = await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO item (category_id, name, image, created_at) VALUES (?, ?, ?, ?)',
          [category_id, name, imagePath, getCurrentUTCTimestamp()],
          function (err) {
            if (err) reject(err); else resolve(this.lastID);
          }
        );
      });

      const createdVariants = [];

      // 3. Process each variant
      for (const variantData of variants) {
        const { variantName, barcode, sellingPrice, buyingPrice, initialQuantity, description } = variantData;

        if (!variantName || !sellingPrice) {
          throw new Error(`Variant ${variantName || 'unnamed'} is missing required fields`);
        }

        // Get or create variant_id
        let variant_id;
        const variantRow = await new Promise((resolve, reject) => {
          db.get('SELECT id FROM variant WHERE variant_name = ?', [variantName], (err, row) => {
            if (err) reject(err); else resolve(row);
          });
        });

        if (variantRow) {
          variant_id = variantRow.id;
        } else {
          variant_id = await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO variant (variant_name, created_at) VALUES (?, ?)',
              [variantName, getCurrentUTCTimestamp()],
              function (err) {
                if (err) reject(err); else resolve(this.lastID);
              }
            );
          });
        }

        // Insert into item_variant table
        const item_variant_id = await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO item_variant (variant_id, item_id, barcode, created_at) VALUES (?, ?, ?, ?)',
            [variant_id, item_id, barcode, getCurrentUTCTimestamp()],
            function (err) {
              if (err) {
                if (err.message.includes('UNIQUE constraint failed: item_variant.barcode')) {
                  reject(new Error(`Barcode ${barcode} already exists`));
                } else {
                  reject(err);
                }
              } else {
                resolve(this.lastID);
              }
            }
          );
        });

        // Insert into stock_batch
        const stock_batch_id = await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO stock_batch (item_variant_id, initial_qty, remaining_qty, buy_price, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [item_variant_id, parseInt(initialQuantity || 0), parseInt(initialQuantity || 0), parseFloat(buyingPrice || 0), description || null, getCurrentUTCTimestamp()],
            function (err) {
              if (err) reject(err); else resolve(this.lastID);
            }
          );
        });

        // Insert into sell_price_history
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO sell_price_history (item_variant_id, user_id, selling_price, stock_batch_id, created_at) VALUES (?, ?, ?, ?, ?)',
            [item_variant_id, 1, parseFloat(sellingPrice), stock_batch_id, getCurrentUTCTimestamp()],
            function (err) {
              if (err) reject(err); else resolve();
            }
          );
        });

        createdVariants.push({
          item_variant_id,
          variantName,
          barcode,
          sellingPrice: parseFloat(sellingPrice),
          initialQuantity: parseInt(initialQuantity || 0)
        });
      }

      db.run('COMMIT');
      res.status(201).json({
        message: 'Item with variants created successfully',
        item_id,
        created_variants: createdVariants
      });

    } catch (error) {
      db.run('ROLLBACK');
      console.error('Transaction failed:', error.message);
      res.status(500).json({ error: error.message });
    }
  });
});

// Add stock batch to existing item variant
server.post('/api/stock-batch/add', async (req, res) => {
  const db = getDatabase();
  const { item_variant_id, buyingPrice, quantity, description } = req.body;

  if (!item_variant_id || !quantity || !buyingPrice) {
    return res.status(400).json({ error: 'Missing required fields: item_variant_id, quantity, buyingPrice' });
  }

  db.serialize(async () => {
    db.run('BEGIN TRANSACTION');
    try {
      // Create new stock batch
      const stock_batch_id = await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO stock_batch (item_variant_id, buy_price, initial_qty, remaining_qty, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [item_variant_id, parseFloat(buyingPrice), parseInt(quantity), parseInt(quantity), description || null, getCurrentUTCTimestamp()],
          function (err) {
            if (err) reject(err); else resolve(this.lastID);
          }
        );
      });

      db.run('COMMIT');
      res.status(201).json({
        message: 'Stock batch added successfully',
        stock_batch_id
      });

    } catch (error) {
      db.run('ROLLBACK');
      console.error('Transaction failed:', error.message);
      res.status(500).json({ error: error.message });
    }
  });
});


// Update item variant with full data (item, variant, price, etc.)
server.put('/api/item-variants/:id/update-full', upload.single('image'), async (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { name, category, variant, barcode, sellingPrice, buyingPrice, initialQuantity, description, is_qty_managed } = req.body;
  const imagePath = req.file ? req.file.path : null;

  if (!name || !category || !variant || !sellingPrice) {
    return res.status(400).json({ error: 'Missing required fields: name, category, variant, sellingPrice' });
  }

  db.serialize(async () => {
    db.run('BEGIN TRANSACTION');
    try {
      // 1. Get current item variant data
      const currentData = await new Promise((resolve, reject) => {
        db.get(
          `SELECT iv.*, i.id as item_id, i.name as item_name, i.category_id, v.variant_name
           FROM item_variant iv
           JOIN item i ON iv.item_id = i.id
           JOIN variant v ON iv.variant_id = v.id
           WHERE iv.id = ?`,
          [id],
          (err, row) => {
            if (err) reject(err); else resolve(row);
          }
        );
      });

      if (!currentData) {
        throw new Error('Item variant not found');
      }

      // 2. Get category_id
      const categoryRow = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM category WHERE name = ?', [category], (err, row) => {
          if (err) reject(err); else resolve(row);
        });
      });

      if (!categoryRow) {
        throw new Error('Category not found');
      }
      const category_id = categoryRow.id;

      // 3. Update item table
      const updateFields = ['name = ?', 'category_id = ?'];
      const updateValues = [name, category_id];

      if (imagePath) {
        updateFields.push('image = ?');
        updateValues.push(imagePath);
      }

      if (is_qty_managed !== undefined) {
        updateFields.push('is_qty_managed = ?');
        updateValues.push(is_qty_managed ? 1 : 0);
      }

      updateValues.push(currentData.item_id);

      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE item SET ${updateFields.join(', ')} WHERE id = ?`,
          updateValues,
          function (err) {
            if (err) reject(err); else resolve();
          }
        );
      });

      // 4. Get or create variant_id
      let variant_id;
      const variantRow = await new Promise((resolve, reject) => {
        db.get('SELECT id FROM variant WHERE variant_name = ?', [variant], (err, row) => {
          if (err) reject(err); else resolve(row);
        });
      });

      if (variantRow) {
        variant_id = variantRow.id;
      } else {
        variant_id = await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO variant (variant_name, created_at) VALUES (?, ?)',
            [variant, getCurrentUTCTimestamp()],
            function (err) {
              if (err) reject(err); else resolve(this.lastID);
            }
          );
        });
      }

      // 5. Update item_variant table
      // Normalize barcode: treat empty string or undefined as NULL so UNIQUE constraint isn't triggered by duplicate empty strings
      const normalizedBarcode = (typeof barcode === 'string' && barcode.trim() === '') || barcode === undefined ? null : barcode;

      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE item_variant SET variant_id = ?, barcode = ? WHERE id = ?',
          [variant_id, normalizedBarcode, id],
          function (err) {
            if (err) {
              if (err.message.includes('UNIQUE constraint failed: item_variant.barcode')) {
                reject(new Error('Barcode already exists. Please use a different barcode.'));
              } else {
                reject(err);
              }
            } else {
              resolve();
            }
          }
        );
      });

      // 6. Update selling price (create new history entry if price changed)
      const currentPrice = await new Promise((resolve, reject) => {
        db.get(
          'SELECT selling_price FROM sell_price_history WHERE item_variant_id = ? ORDER BY created_at DESC LIMIT 1',
          [id],
          (err, row) => {
            if (err) reject(err); else resolve(row ? row.selling_price : null);
          }
        );
      });

      let latest_stock_batch_id = null;

      // 7. Update stock if initialQuantity is provided and different
      if (initialQuantity && buyingPrice !== undefined) {
        // Check if there's existing stock
        const existingStock = await new Promise((resolve, reject) => {
          db.get(
            'SELECT SUM(remaining_qty) as total FROM stock_batch WHERE item_variant_id = ?',
            [id],
            (err, row) => {
              if (err) reject(err); else resolve(row ? row.total : 0);
            }
          );
        });

        const newQuantity = parseInt(initialQuantity);
        const currentTotal = existingStock || 0;

        if (newQuantity !== currentTotal) {
          // Add new stock batch for the difference
          const difference = newQuantity - currentTotal;
          if (difference > 0) {
            latest_stock_batch_id = await new Promise((resolve, reject) => {
              db.run(
                'INSERT INTO stock_batch (item_variant_id, initial_qty, remaining_qty, buy_price, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [id, difference, difference, parseFloat(buyingPrice || 0), description || null, getCurrentUTCTimestamp()],
                function (err) {
                  if (err) reject(err); else resolve(this.lastID);
                }
              );
            });
          }
        } else {
          // Get the latest stock batch ID for price history reference
          const latestBatch = await new Promise((resolve, reject) => {
            db.get(
              'SELECT id FROM stock_batch WHERE item_variant_id = ? ORDER BY created_at DESC LIMIT 1',
              [id],
              (err, row) => {
                if (err) reject(err); else resolve(row);
              }
            );
          });
          latest_stock_batch_id = latestBatch ? latestBatch.id : null;
        }
      }

      // 8. Create price history entry if price changed, with stock_batch_id reference
      if (!currentPrice || parseFloat(currentPrice) !== parseFloat(sellingPrice)) {
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO sell_price_history (item_variant_id, user_id, selling_price, stock_batch_id, created_at) VALUES (?, ?, ?, ?, ?)',
            [id, 1, parseFloat(sellingPrice), latest_stock_batch_id, getCurrentUTCTimestamp()], // Using admin user_id = 1 as default
            function (err) {
              if (err) reject(err); else resolve();
            }
          );
        });
      }

      db.run('COMMIT');
      res.json({ message: 'Item variant updated successfully', item_variant_id: id });

    } catch (error) {
      db.run('ROLLBACK');
      console.error('Update transaction failed:', error.message);
      res.status(500).json({ error: error.message });
    }
  });
});

// Get sell price history for an item variant
server.get('/api/sell-price-history/:variantId', (req, res) => {
  const db = getDatabase();
  const { variantId } = req.params;

  db.all(
    `SELECT 
  id,
  selling_price,
  created_at,
  user_id
FROM sell_price_history
WHERE item_variant_id = ?
ORDER BY created_at DESC`,
    [variantId],
    (err, rows) => {
      if (err) {
        console.error('Error fetching sell price history:', err);
        return res.status(500).json({ error: 'Failed to fetch sell price history' });
      }
      res.json(rows);
    }
  );
});

// Update sell price (creates new history entry)
server.post('/api/update-sell-price', (req, res) => {
  const db = getDatabase();
  const { item_variant_id, selling_price, user_id = 1, stock_batch_id } = req.body;

  if (!item_variant_id || !selling_price) {
    return res.status(400).json({ error: 'item_variant_id and selling_price are required' });
  }

  // Get the latest stock batch ID if not provided
  const getStockBatchId = () => {
    if (stock_batch_id) {
      return Promise.resolve(stock_batch_id);
    }

    return new Promise((resolve, reject) => {
      db.get(
        'SELECT id FROM stock_batch WHERE item_variant_id = ? ORDER BY created_at DESC LIMIT 1',
        [item_variant_id],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.id : null);
        }
      );
    });
  };

  getStockBatchId()
    .then(batchId => {
      // Insert new price history entry with stock_batch_id reference
      db.run(
        `INSERT INTO sell_price_history (item_variant_id, user_id, selling_price, stock_batch_id, created_at) 
         VALUES (?, ?, ?, ?, ?)`,
        [item_variant_id, user_id, parseFloat(selling_price), batchId, getCurrentUTCTimestamp()],
        function (err) {
          if (err) {
            console.error('Error updating sell price:', err);
            return res.status(500).json({ error: 'Failed to update sell price' });
          }

          res.json({
            message: 'Sell price updated successfully',
            historyId: this.lastID,
            stock_batch_id: batchId
          });
        }
      );
    })
    .catch(err => {
      console.error('Error getting stock batch ID:', err);
      res.status(500).json({ error: 'Failed to get stock batch information' });
    });
});

// Health check
server.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'POS API is running' });
});

// Error handling middleware
server.use((err, req, res, next) => {
  console.error(err.stack);

  // Handle multer errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size too large. Maximum 5MB allowed.' });
    }
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({ error: 'Something went wrong!' });
});

module.exports = server;