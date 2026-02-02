const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app } = require('electron');

let db;
let isInitialized = false;

// Utility function to get current UTC timestamp in SQLite format
const getCurrentUTCTimestamp = () => {
  return new Date().toISOString();
};

const initializeDatabase = () => {
  if (isInitialized) {
    return;
  }

  const dbPath = path.join(app.getPath('userData'), 'restaurant_pos.db');
  db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
      console.error('Database connection failed:', err.message);
      return;
    }

    // Configure database for better concurrency and performance
    db.configure('busyTimeout', 5000); // Reduced timeout

    // Enable WAL mode for better concurrency
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA cache_size = 2000;
    `, (err) => {
      if (err) {
        console.error('Database config error:', err.message);
      }
      isInitialized = true;
      createTables();
      createIndexes();
    });
  });
};

const createTables = () => {
  db.serialize(() => {
    // Staff table
    db.run(`
      CREATE TABLE IF NOT EXISTS staff (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        username TEXT UNIQUE,
        pin TEXT NOT NULL,
        role TEXT CHECK(role IN ('admin', 'cashier')) NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Cashier Shift table
    db.run(`
      CREATE TABLE IF NOT EXISTS cashier_shift (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER NOT NULL,
        initial_cash_onhand DECIMAL(10,2),
        current_cash_onhand DECIMAL(10,2),
        open_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        close_at DATETIME,
        description TEXT,
        status TEXT CHECK(status IN ('open', 'closed')) NOT NULL,
        FOREIGN KEY (staff_id) REFERENCES staff(id)
      )
    `);

    // Category table
    db.run(`
      CREATE TABLE IF NOT EXISTS category (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Item table
    db.run(`
      CREATE TABLE IF NOT EXISTS item (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        image TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES category(id)
      )
    `);

    // Variant table
    db.run(`
      CREATE TABLE IF NOT EXISTS variant (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        variant_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Item Variant table
    db.run(`
      CREATE TABLE IF NOT EXISTS item_variant (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        variant_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        barcode TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (variant_id) REFERENCES variant(id),
        FOREIGN KEY (item_id) REFERENCES item(id)
      )
    `);

    // Order table
    db.run(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER NOT NULL,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        additional_charges DECIMAL(10,2) DEFAULT 0,
        total_amount DECIMAL(10,2) NOT NULL,
        customer_name TEXT,
        status TEXT CHECK(status IN ('active', 'completed', 'cancelled')) DEFAULT 'active',
        tender_cash DECIMAL(10,2),
        discount_type TEXT CHECK(discount_type IN ('fixed', 'percent')),
        discount_value DECIMAL(10,2) DEFAULT 0,
        is_card_payment BOOLEAN DEFAULT 0,
        FOREIGN KEY (staff_id) REFERENCES staff(id)
      )
    `);

    // Item Variant Order table
    db.run(`
      CREATE TABLE IF NOT EXISTS item_variant_order (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_variant_id INTEGER NOT NULL,
        order_id INTEGER NOT NULL,
        qty INTEGER NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(item_variant_id, order_id),
        FOREIGN KEY (item_variant_id) REFERENCES item_variant(id),
        FOREIGN KEY (order_id) REFERENCES orders(id)
      )
    `);

    // Sell Price History table
    db.run(`
      CREATE TABLE IF NOT EXISTS sell_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_variant_id INTEGER NOT NULL,
        staff_id INTEGER NOT NULL,
        selling_price DECIMAL(10,2) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_variant_id) REFERENCES item_variant(id),
        FOREIGN KEY (staff_id) REFERENCES staff(id)
      )
    `);

    // In/Out Transaction table for restaurant expenses/revenue
    db.run(`
      CREATE TABLE IF NOT EXISTS in_out (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT CHECK(type IN ('IN', 'OUT')) NOT NULL,
        description TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        staff_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (staff_id) REFERENCES staff(id)
      )
    `);

    // Supplier table
    db.run(`
      CREATE TABLE IF NOT EXISTS supplier (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone_number TEXT,
        description TEXT
      )
    `);

    // Stock Batch table
    db.run(`
      CREATE TABLE IF NOT EXISTS stock_batch (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_variant_id INTEGER NOT NULL,
        buy_price DECIMAL(10,2) NOT NULL,
        initial_qty INTEGER NOT NULL,
        remaining_qty INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        description TEXT,
        expire_date DATE,
        supplier_id INTEGER,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (item_variant_id) REFERENCES item_variant(id),
        FOREIGN KEY (supplier_id) REFERENCES supplier(id)
      )
    `);

    // Insert default admin user
    insertDefaultData();
  });
};

// Create indexes for performance optimization
const createIndexes = () => {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_item_category ON item(category_id)',
    'CREATE INDEX IF NOT EXISTS idx_item_name ON item(name)',
    'CREATE INDEX IF NOT EXISTS idx_item_variant_item ON item_variant(item_id)',
    'CREATE INDEX IF NOT EXISTS idx_item_variant_variant ON item_variant(variant_id)',
    'CREATE INDEX IF NOT EXISTS idx_item_variant_barcode ON item_variant(barcode)',
    'CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)',
    'CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date)',
    'CREATE INDEX IF NOT EXISTS idx_orders_staff ON orders(staff_id)',
    'CREATE INDEX IF NOT EXISTS idx_item_variant_order_order ON item_variant_order(order_id)',
    'CREATE INDEX IF NOT EXISTS idx_item_variant_order_variant ON item_variant_order(item_variant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sell_price_variant ON sell_price_history(item_variant_id)',
    'CREATE INDEX IF NOT EXISTS idx_sell_price_created ON sell_price_history(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_cashier_shift_staff ON cashier_shift(staff_id)',
    'CREATE INDEX IF NOT EXISTS idx_cashier_shift_status ON cashier_shift(status)',
    'CREATE INDEX IF NOT EXISTS idx_cashier_shift_open_at ON cashier_shift(open_at)',
    'CREATE INDEX IF NOT EXISTS idx_stock_batch_item_variant ON stock_batch(item_variant_id)',
    'CREATE INDEX IF NOT EXISTS idx_stock_batch_supplier ON stock_batch(supplier_id)',
    'CREATE INDEX IF NOT EXISTS idx_stock_batch_expire_date ON stock_batch(expire_date)'
  ];

  db.serialize(() => {
    indexes.forEach(index => {
      db.run(index);
    });
  });
};

const insertDefaultData = () => {
  // Check if admin exists
  db.get('SELECT id FROM staff WHERE role = "admin"', (err, row) => {
    if (err || row) return;

    // Insert default admin
    db.run(
      'INSERT INTO staff (name, username, pin, role) VALUES (?, ?, ?, ?)',
      ['Admin', 'admin', '1234', 'admin']
    );
  });

  // Insert default categories in batch
  const defaultCategories = ['Electronics', 'Clothing', 'Accessories', 'Desserts', 'Snacks', 'Tobacco', 'Other'];
  db.serialize(() => {
    defaultCategories.forEach(categoryName => {
      db.run('INSERT OR IGNORE INTO category (name) VALUES (?)', [categoryName]);
    });
  });
};

// Close database connection properly
const closeDatabase = () => {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve();
      return;
    }

    db.close((err) => {
      if (err) {
        reject(err);
      } else {
        db = null;
        isInitialized = false;
        resolve();
      }
    });
  });
};

const getDatabase = () => {
  return db;
};

// Manual backup function (call when needed)
const backupDatabase = () => {
  if (!db) return null;
  
  const fs = require('fs');
  const path = require('path');
  const { app } = require('electron');
  
  const dbPath = path.join(app.getPath('userData'), 'restaurant_pos.db');
  const backupPath = path.join(
    app.getPath('userData'), 
    `restaurant_pos_backup_${Date.now()}.db`
  );
  
  try {
    fs.copyFileSync(dbPath, backupPath);
    return backupPath;
  } catch (error) {
    return null;
  }
};

module.exports = {
  initializeDatabase,
  getDatabase,
  closeDatabase,
  backupDatabase,
  getCurrentUTCTimestamp
};