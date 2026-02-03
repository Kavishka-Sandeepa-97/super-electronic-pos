const express = require('express');
const cors = require('cors');
const path = require('path');
const { app } = require('electron');
const multer = require('multer'); // Import multer
const compression = require('compression'); // Add compression

// Import routes
const staffRoutes = require('./routes/staff');
const categoryRoutes = require('./routes/category');
const brandRoutes = require('./routes/brand');
const itemRoutes = require('./routes/item');
const variantRoutes = require('./routes/variant');
const itemVariantRoutes = require('./routes/itemVariant');
const orderRoutes = require('./routes/order');
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
server.use('/api/brands', brandRoutes);
server.use('/api/items', itemRoutes);
server.use('/api/variants', variantRoutes);
server.use('/api/item-variants', itemVariantRoutes);
server.use('/api/orders', orderRoutes);
server.use('/api/in-out', inOutRoutes);
server.use('/api/cashier-shifts', cashierShiftRoutes);

// Reports routes
server.use('/api/reports', reportsRoutes);

// New route for creating item with variant and image
server.post('/api/item-variants/create-full', upload.single('image'), (req, res) => {
  const db = getDatabase();
  const { name, category, variant, barcode, sellingPrice, buyingPrice, initialQuantity, description } = req.body;
  const imagePath = req.file ? req.file.path : null;

  if (!name || !category || !variant || !sellingPrice || !initialQuantity) {
    return res.status(400).json({ error: 'Missing required fields: name, category, variant, sellingPrice, initialQuantity' });
  }

  const transaction = db.transaction(() => {
    // 1. Get category_id
    const categoryRow = db.prepare('SELECT id FROM category WHERE name = ?').get(category);
    if (!categoryRow) {
      throw new Error('Category not found');
    }
    const category_id = categoryRow.id;

    // 2. Insert into item table
    const itemResult = db.prepare(
      'INSERT INTO item (category_id, name, image, created_at) VALUES (?, ?, ?, ?)'
    ).run(category_id, name, imagePath, getCurrentUTCTimestamp());
    const item_id = itemResult.lastInsertRowid;

    // 3. Get or create variant_id
    let variant_id;
    const variantRow = db.prepare('SELECT id FROM variant WHERE variant_name = ?').get(variant);
    if (variantRow) {
      variant_id = variantRow.id;
    } else {
      const variantResult = db.prepare(
        'INSERT INTO variant (variant_name, created_at) VALUES (?, ?)'
      ).run(variant, getCurrentUTCTimestamp());
      variant_id = variantResult.lastInsertRowid;
    }

    // 4. Insert into item_variant table
    let item_variant_id;
    try {
      const ivResult = db.prepare(
        'INSERT INTO item_variant (variant_id, item_id, barcode, created_at) VALUES (?, ?, ?, ?)'
      ).run(variant_id, item_id, barcode, getCurrentUTCTimestamp());
      item_variant_id = ivResult.lastInsertRowid;
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed: item_variant.barcode')) {
        throw new Error('Barcode already exists. Please use a different barcode.');
      }
      throw err;
    }

    // 5. Insert into stock_batch with description
    const stockResult = db.prepare(
      'INSERT INTO stock_batch (item_variant_id, initial_qty, remaining_qty, buy_price, description, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(item_variant_id, parseInt(initialQuantity), parseInt(initialQuantity), parseFloat(buyingPrice || 0), description || null, getCurrentUTCTimestamp());
    const stock_batch_id = stockResult.lastInsertRowid;

    // 6. Insert into sell_price_history with stock_batch_id reference
    db.prepare(
      'INSERT INTO sell_price_history (item_variant_id, staff_id, selling_price, stock_batch_id, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(item_variant_id, 1, parseFloat(sellingPrice), stock_batch_id, getCurrentUTCTimestamp());

    return item_variant_id;
  });

  try {
    const item_variant_id = transaction();
    res.status(201).json({ message: 'Item, variant, and stock created successfully', item_variant_id });
  } catch (error) {
    console.error('Transaction failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// New route for creating item with multiple variants
server.post('/api/items/create-with-variants', upload.single('image'), (req, res) => {
  const db = getDatabase();
  const { name, category } = req.body;
  const variants = JSON.parse(req.body.variants || '[]');
  const imagePath = req.file ? req.file.path : null;

  if (!name || !category || !variants || variants.length === 0) {
    return res.status(400).json({ error: 'Missing required fields: name, category, variants array' });
  }

  const transaction = db.transaction(() => {
    // 1. Get category_id
    const categoryRow = db.prepare('SELECT id FROM category WHERE name = ?').get(category);
    if (!categoryRow) {
      throw new Error('Category not found');
    }
    const category_id = categoryRow.id;

    // 2. Insert into item table
    const itemResult = db.prepare(
      'INSERT INTO item (category_id, name, image, created_at) VALUES (?, ?, ?, ?)'
    ).run(category_id, name, imagePath, getCurrentUTCTimestamp());
    const item_id = itemResult.lastInsertRowid;

    const createdVariants = [];

    // 3. Process each variant
    for (const variantData of variants) {
      const { variantName, barcode, sellingPrice, buyingPrice, initialQuantity, description } = variantData;

      if (!variantName || !sellingPrice) {
        throw new Error(`Variant ${variantName || 'unnamed'} is missing required fields`);
      }

      // Get or create variant_id
      let variant_id;
      const variantRow = db.prepare('SELECT id FROM variant WHERE variant_name = ?').get(variantName);
      if (variantRow) {
        variant_id = variantRow.id;
      } else {
        const variantResult = db.prepare(
          'INSERT INTO variant (variant_name, created_at) VALUES (?, ?)'
        ).run(variantName, getCurrentUTCTimestamp());
        variant_id = variantResult.lastInsertRowid;
      }

      // Insert into item_variant table
      let item_variant_id;
      try {
        const ivResult = db.prepare(
          'INSERT INTO item_variant (variant_id, item_id, barcode, created_at) VALUES (?, ?, ?, ?)'
        ).run(variant_id, item_id, barcode, getCurrentUTCTimestamp());
        item_variant_id = ivResult.lastInsertRowid;
      } catch (err) {
        if (err.message.includes('UNIQUE constraint failed: item_variant.barcode')) {
          throw new Error(`Barcode ${barcode} already exists`);
        }
        throw err;
      }

      // Insert into stock_batch
      const stockResult = db.prepare(
        'INSERT INTO stock_batch (item_variant_id, initial_qty, remaining_qty, buy_price, description, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(item_variant_id, parseInt(initialQuantity || 0), parseInt(initialQuantity || 0), parseFloat(buyingPrice || 0), description || null, getCurrentUTCTimestamp());
      const stock_batch_id = stockResult.lastInsertRowid;

      // Insert into sell_price_history
      db.prepare(
        'INSERT INTO sell_price_history (item_variant_id, staff_id, selling_price, stock_batch_id, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(item_variant_id, 1, parseFloat(sellingPrice), stock_batch_id, getCurrentUTCTimestamp());

      createdVariants.push({
        item_variant_id,
        variantName,
        barcode,
        sellingPrice: parseFloat(sellingPrice),
        initialQuantity: parseInt(initialQuantity || 0)
      });
    }

    return { item_id, createdVariants };
  });

  try {
    const result = transaction();
    res.status(201).json({
      message: 'Item with variants created successfully',
      item_id: result.item_id,
      created_variants: result.createdVariants
    });
  } catch (error) {
    console.error('Transaction failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Add stock batch to existing item variant
server.post('/api/stock-batch/add', (req, res) => {
  const db = getDatabase();
  const { item_variant_id, buyingPrice, quantity, description } = req.body;

  if (!item_variant_id || !quantity || !buyingPrice) {
    return res.status(400).json({ error: 'Missing required fields: item_variant_id, quantity, buyingPrice' });
  }

  const transaction = db.transaction(() => {
    // Create new stock batch
    const result = db.prepare(
      'INSERT INTO stock_batch (item_variant_id, buy_price, initial_qty, remaining_qty, description, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(item_variant_id, parseFloat(buyingPrice), parseInt(quantity), parseInt(quantity), description || null, getCurrentUTCTimestamp());
    return result.lastInsertRowid;
  });

  try {
    const stock_batch_id = transaction();
    res.status(201).json({
      message: 'Stock batch added successfully',
      stock_batch_id
    });
  } catch (error) {
    console.error('Transaction failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});


// Update item variant with full data (item, variant, price, etc.)
server.put('/api/item-variants/:id/update-full', upload.single('image'), (req, res) => {
  const db = getDatabase();
  const { id } = req.params;
  const { name, category, variant, barcode, sellingPrice, buyingPrice, initialQuantity, description } = req.body;
  const imagePath = req.file ? req.file.path : null;

  if (!name || !category || !variant || !sellingPrice) {
    return res.status(400).json({ error: 'Missing required fields: name, category, variant, sellingPrice' });
  }

  const transaction = db.transaction(() => {
    // 1. Get current item variant data
    const currentData = db.prepare(`
      SELECT iv.*, i.id as item_id, i.name as item_name, i.category_id, v.variant_name
      FROM item_variant iv
      JOIN item i ON iv.item_id = i.id
      JOIN variant v ON iv.variant_id = v.id
      WHERE iv.id = ?
    `).get(id);

    if (!currentData) {
      throw new Error('Item variant not found');
    }

    // 2. Get category_id
    const categoryRow = db.prepare('SELECT id FROM category WHERE name = ?').get(category);
    if (!categoryRow) {
      throw new Error('Category not found');
    }
    const category_id = categoryRow.id;

    // 3. Update item table
    if (imagePath) {
      db.prepare('UPDATE item SET name = ?, category_id = ?, image = ? WHERE id = ?')
        .run(name, category_id, imagePath, currentData.item_id);
    } else {
      db.prepare('UPDATE item SET name = ?, category_id = ? WHERE id = ?')
        .run(name, category_id, currentData.item_id);
    }

    // 4. Get or create variant_id
    let variant_id;
    const variantRow = db.prepare('SELECT id FROM variant WHERE variant_name = ?').get(variant);
    if (variantRow) {
      variant_id = variantRow.id;
    } else {
      const variantResult = db.prepare(
        'INSERT INTO variant (variant_name, created_at) VALUES (?, ?)'
      ).run(variant, getCurrentUTCTimestamp());
      variant_id = variantResult.lastInsertRowid;
    }

    // 5. Update item_variant table
    const normalizedBarcode = (typeof barcode === 'string' && barcode.trim() === '') || barcode === undefined ? null : barcode;
    try {
      db.prepare('UPDATE item_variant SET variant_id = ?, barcode = ? WHERE id = ?')
        .run(variant_id, normalizedBarcode, id);
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed: item_variant.barcode')) {
        throw new Error('Barcode already exists. Please use a different barcode.');
      }
      throw err;
    }

    // 6. Get current selling price
    const currentPriceRow = db.prepare(
      'SELECT selling_price FROM sell_price_history WHERE item_variant_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(id);
    const currentPrice = currentPriceRow ? currentPriceRow.selling_price : null;

    let latest_stock_batch_id = null;

    // 7. Update stock if initialQuantity is provided and different
    if (initialQuantity && buyingPrice !== undefined) {
      const existingStock = db.prepare(
        'SELECT SUM(remaining_qty) as total FROM stock_batch WHERE item_variant_id = ?'
      ).get(id);
      
      const newQuantity = parseInt(initialQuantity);
      const currentTotal = existingStock?.total || 0;

      if (newQuantity !== currentTotal) {
        const difference = newQuantity - currentTotal;
        if (difference > 0) {
          const stockResult = db.prepare(
            'INSERT INTO stock_batch (item_variant_id, initial_qty, remaining_qty, buy_price, description, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(id, difference, difference, parseFloat(buyingPrice || 0), description || null, getCurrentUTCTimestamp());
          latest_stock_batch_id = stockResult.lastInsertRowid;
        }
      } else {
        const latestBatch = db.prepare(
          'SELECT id FROM stock_batch WHERE item_variant_id = ? ORDER BY created_at DESC LIMIT 1'
        ).get(id);
        latest_stock_batch_id = latestBatch ? latestBatch.id : null;
      }
    }

    // 8. Create price history entry if price changed
    if (!currentPrice || parseFloat(currentPrice) !== parseFloat(sellingPrice)) {
      db.prepare(
        'INSERT INTO sell_price_history (item_variant_id, staff_id, selling_price, stock_batch_id, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(id, 1, parseFloat(sellingPrice), latest_stock_batch_id, getCurrentUTCTimestamp());
    }

    return id;
  });

  try {
    const item_variant_id = transaction();
    res.json({ message: 'Item variant updated successfully', item_variant_id });
  } catch (error) {
    console.error('Update transaction failed:', error.message);
    if (error.message === 'Item variant not found' || error.message === 'Category not found') {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Get sell price history for an item variant
server.get('/api/sell-price-history/:variantId', (req, res) => {
  const db = getDatabase();
  const { variantId } = req.params;

  try {
    const rows = db.prepare(`
      SELECT 
        id,
        selling_price,
        created_at,
        staff_id
      FROM sell_price_history
      WHERE item_variant_id = ?
      ORDER BY created_at DESC
    `).all(variantId);
    res.json(rows);
  } catch (err) {
    console.error('Error fetching sell price history:', err);
    res.status(500).json({ error: 'Failed to fetch sell price history' });
  }
});

// Update sell price (creates new history entry)
server.post('/api/update-sell-price', (req, res) => {
  const db = getDatabase();
  const { item_variant_id, selling_price, staff_id = 1, stock_batch_id } = req.body;

  if (!item_variant_id || !selling_price) {
    return res.status(400).json({ error: 'item_variant_id and selling_price are required' });
  }

  try {
    // Get the latest stock batch ID if not provided
    let batchId = stock_batch_id;
    if (!batchId) {
      const latestBatch = db.prepare(
        'SELECT id FROM stock_batch WHERE item_variant_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(item_variant_id);
      batchId = latestBatch ? latestBatch.id : null;
    }

    // Insert new price history entry with stock_batch_id reference
    const result = db.prepare(`
      INSERT INTO sell_price_history (item_variant_id, staff_id, selling_price, stock_batch_id, created_at) 
      VALUES (?, ?, ?, ?, ?)
    `).run(item_variant_id, staff_id, parseFloat(selling_price), batchId, getCurrentUTCTimestamp());

    res.json({
      message: 'Sell price updated successfully',
      historyId: result.lastInsertRowid,
      stock_batch_id: batchId
    });
  } catch (err) {
    console.error('Error updating sell price:', err);
    res.status(500).json({ error: 'Failed to update sell price' });
  }
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