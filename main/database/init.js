const Database = require('better-sqlite3');
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

  const dbPath = path.join(app.getPath('userData'), 'super-glow.db');
  
  try {
    db = new Database(dbPath);
    
    // Configure database for better performance
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = 2000');
    db.pragma('busy_timeout = 5000');
    
    isInitialized = true;
    createTables();
    createIndexes();
    
    console.log('Database initialized successfully at:', dbPath);
  } catch (err) {
    console.error('Database connection failed:', err.message);
  }
};

// Database migration function to handle schema changes
const runMigrations = () => {
  try {
    // Create migrations tracking table
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migration v1.3: Add discount columns to item_variant
    const addDiscountMigration = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get('v1.3_add_discount_columns');
    
    if (!addDiscountMigration) {
      const tableInfo = db.pragma('table_info(item_variant)');
      const hasDiscountType = tableInfo.some(column => column.name === 'discount_type');
      
      if (!hasDiscountType) {
        console.log('Running migration v1.3: Adding discount columns to item_variant table...');
        db.exec(`
          ALTER TABLE item_variant ADD COLUMN is_discount_active BOOLEAN DEFAULT 0;
          ALTER TABLE item_variant ADD COLUMN discount_type TEXT CHECK(discount_type IN ('fixed', 'percentage'));
          ALTER TABLE item_variant ADD COLUMN discount_value DECIMAL(10,2) DEFAULT 0;
        `);
        console.log('Migration v1.3 completed successfully - discount columns added');
      }
      
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run('v1.3_add_discount_columns');
    }

    // Migration v1.2: Remove stock_batch_id column
    const removeStockBatchMigration = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get('v1.2_remove_stock_batch_id');
    
    if (!removeStockBatchMigration) {
      // Check if column exists (for existing databases)
      const tableInfo = db.pragma('table_info(sell_price_history)');
      const hasStockBatchId = tableInfo.some(column => column.name === 'stock_batch_id');
      
      if (hasStockBatchId) {
        console.log('Running migration v1.2: Removing stock_batch_id column from sell_price_history table...');
        
        // SQLite doesn't support DROP COLUMN, so we recreate the table
        db.exec(`
          -- Create new table without stock_batch_id
          CREATE TABLE sell_price_history_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_variant_id INTEGER NOT NULL,
            staff_id INTEGER NOT NULL,
            selling_price DECIMAL(10,2) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (item_variant_id) REFERENCES item_variant(id),
            FOREIGN KEY (staff_id) REFERENCES staff(id)
          );
          
          -- Copy data from old table (excluding stock_batch_id)
          INSERT INTO sell_price_history_new (id, item_variant_id, staff_id, selling_price, created_at, updated_at)
          SELECT id, item_variant_id, staff_id, selling_price, created_at, updated_at 
          FROM sell_price_history;
          
          -- Drop old table
          DROP TABLE sell_price_history;
          
          -- Rename new table
          ALTER TABLE sell_price_history_new RENAME TO sell_price_history;
        `);
        
        console.log('Migration v1.2 completed successfully - stock_batch_id column removed');
      }
      
      // Mark migration as completed
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run('v1.2_remove_stock_batch_id');
    }

  } catch (error) {
    // If sell_price_history table doesn't exist yet, the migration will be handled by CREATE TABLE
    console.log('Migration check completed:', error.message);
  }
};

const createTables = () => {
  // Run migrations first
  runMigrations();
  
  // Staff table
  db.exec(`
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
  db.exec(`
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

  // Brand table
  db.exec(`
    CREATE TABLE IF NOT EXISTS brand (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Category table
  db.exec(`
    CREATE TABLE IF NOT EXISTS category (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      parent_id INTEGER NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES category(id)
    )
  `);

  // Item table
  db.exec(`
    CREATE TABLE IF NOT EXISTS item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      brand_id INTEGER,
      name TEXT NOT NULL,
      gender TEXT CHECK(gender IN ('MEN', 'WOMEN', 'UNISEX')),
      image TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES category(id),
      FOREIGN KEY (brand_id) REFERENCES brand(id)
    )
  `);

  // Variant table
  db.exec(`
    CREATE TABLE IF NOT EXISTS variant (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variant_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Item Variant table
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_variant (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variant_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      barcode TEXT UNIQUE,
      is_discount_active BOOLEAN DEFAULT 0,
      discount_type TEXT CHECK(discount_type IN ('fixed', 'percentage')),
      discount_value DECIMAL(10,2) DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (variant_id) REFERENCES variant(id),
      FOREIGN KEY (item_id) REFERENCES item(id)
    )
  `);

  // Global Discount Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS global_discount_settings (
      key_value TEXT PRIMARY KEY,
      is_global_discount_active BOOLEAN DEFAULT 0,
      global_discount_type TEXT CHECK(global_discount_type IN ('fixed', 'percentage')),
      global_discount_value DECIMAL(10,2) DEFAULT 0,
      min_order_amount DECIMAL(10,2) DEFAULT 0
    )
  `);

  // Order table
  db.exec(`
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
  db.exec(`
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
  db.exec(`
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
  db.exec(`
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS supplier (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone_number TEXT,
      description TEXT
    )
  `);

  // Stock Batch table
  db.exec(`
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
};

// Create indexes for performance optimization
const createIndexes = () => {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_category_parent ON category(parent_id)',
    'CREATE INDEX IF NOT EXISTS idx_item_category ON item(category_id)',
    'CREATE INDEX IF NOT EXISTS idx_item_brand ON item(brand_id)',
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

  indexes.forEach(index => {
    db.exec(index);
  });
};

const insertDefaultData = () => {
  // Check if admin exists
  const admin = db.prepare('SELECT id FROM staff WHERE role = ?').get('admin');
  
  if (!admin) {
    // Insert default admin
    db.prepare('INSERT INTO staff (name, username, pin, role) VALUES (?, ?, ?, ?)').run('Admin', 'admin', '1234', 'admin');
  }

  // Insert default categories with hierarchical structure
  const insertCategoryStmt = db.prepare('INSERT OR IGNORE INTO category (name, parent_id) VALUES (?, ?)');
  const getCategoryIdStmt = db.prepare('SELECT id FROM category WHERE name = ?');
  
  // Main Categories
  const mainCategories = [
    'MAKE-UP',
    'HAIR CARE',
    'SKIN CARE',
    'ACCESSORIES',
    'FRAGRANCE',
    'PERSONAL CARE',
    'SALON EQUIPMENT',
    'APPLIANCES'
  ];
  
  mainCategories.forEach(cat => {
    insertCategoryStmt.run(cat, null);
  });
  
  // MAKE-UP subcategories and sub-subcategories
  const makeupId = getCategoryIdStmt.get('MAKE-UP')?.id;
  if (makeupId) {
    insertCategoryStmt.run('Face', makeupId);
    insertCategoryStmt.run('Lips', makeupId);
    insertCategoryStmt.run('Eyes', makeupId);
    insertCategoryStmt.run('Nails', makeupId);
    insertCategoryStmt.run('Makeup Accessories', makeupId);
    
    // Face subcategories
    const faceId = getCategoryIdStmt.get('Face')?.id;
    if (faceId) {
      const faceItems = [
        'Face Concealer', 'Face Foundation BB & CC Cream', 'Face Compact', 'Face Primer',
        'Face Setting Spray & Fixer', 'Loose Powder', 'Foundation', 'Powder Bronzer',
        'Powder Blush', 'Face Contour & Highlight & Illuminator'
      ];
      faceItems.forEach(item => insertCategoryStmt.run(item, faceId));
    }
    
    // Lips subcategories
    const lipsId = getCategoryIdStmt.get('Lips')?.id;
    if (lipsId) {
      const lipsItems = ['Lipstick', 'Liquid Lipstick', 'Lip Contours & Liner', 'Lip Gloss', 'Lip Primer'];
      lipsItems.forEach(item => insertCategoryStmt.run(item, lipsId));
    }
    
    // Eyes subcategories
    const eyesId = getCategoryIdStmt.get('Eyes')?.id;
    if (eyesId) {
      const eyesItems = [
        'Eye Primer', 'Under Eye Concealer', 'Eyeshadow', 'Eyeliner', 'Kajal & Khls',
        'Mascara', 'Eyebrow', 'Liquid eyeshadow', 'Liquid Eyeliner Pencil',
        'Liquid Eyeliner', 'Eyeshadow Platte'
      ];
      eyesItems.forEach(item => insertCategoryStmt.run(item, eyesId));
    }
    
    // Nails subcategories
    const nailsId = getCategoryIdStmt.get('Nails')?.id;
    if (nailsId) {
      const nailsItems = [
        'Nail Polish', 'Gel Nail Polish', 'Top & Base Coat', 'Nail Polish Remover',
        'Nail Treatments', 'French Manicure Nail Polish'
      ];
      nailsItems.forEach(item => insertCategoryStmt.run(item, nailsId));
    }
    
    // Makeup Accessories subcategories
    const makeupAccId = getCategoryIdStmt.get('Makeup Accessories')?.id;
    if (makeupAccId) {
      const makeupAccItems = ['Makeup Kit', 'Makeup Remover & Wipes', 'Make up tools'];
      makeupAccItems.forEach(item => insertCategoryStmt.run(item, makeupAccId));
    }
  }
  
  // HAIR CARE subcategories
  const hairCareId = getCategoryIdStmt.get('HAIR CARE')?.id;
  if (hairCareId) {
    insertCategoryStmt.run('Hair color', hairCareId);
    insertCategoryStmt.run('Shampoo & Conditioner', hairCareId);
    insertCategoryStmt.run('Styling', hairCareId);
    insertCategoryStmt.run('Nourishment', hairCareId);
    insertCategoryStmt.run('Hair Style', hairCareId);
    
    // Hair color subcategories
    const hairColorId = getCategoryIdStmt.get('Hair color')?.id;
    if (hairColorId) {
      insertCategoryStmt.run('Hair Coloring', hairColorId);
      insertCategoryStmt.run('Others', hairColorId);
    }
    
    // Shampoo & Conditioner subcategories
    const shampooId = getCategoryIdStmt.get('Shampoo & Conditioner')?.id;
    if (shampooId) {
      const shampooItems = ['Shampoo', 'Conditioner', 'Dry Shampoo'];
      shampooItems.forEach(item => insertCategoryStmt.run(item, shampooId));
    }
    
    // Styling subcategories
    const stylingId = getCategoryIdStmt.get('Styling')?.id;
    if (stylingId) {
      const stylingItems = [
        'Hair Spray & Mousse',
        'Leave-In ,Cream ,Gel & Wax',
        'Hair Fiber & Volume powder'
      ];
      stylingItems.forEach(item => insertCategoryStmt.run(item, stylingId));
    }
    
    // Nourishment subcategories
    const nourishmentId = getCategoryIdStmt.get('Nourishment')?.id;
    if (nourishmentId) {
      const nourishmentItems = ['Hair Oil', 'Hair Serum', 'Hair Treatment - Spa & Masque'];
      nourishmentItems.forEach(item => insertCategoryStmt.run(item, nourishmentId));
    }
  }
  
  // SKIN CARE subcategories
  const skinCareId = getCategoryIdStmt.get('SKIN CARE')?.id;
  if (skinCareId) {
    insertCategoryStmt.run('Face Care', skinCareId);
    insertCategoryStmt.run('Eye Care', skinCareId);
    insertCategoryStmt.run('Lip Treatment', skinCareId);
    insertCategoryStmt.run('Body Care', skinCareId);
    insertCategoryStmt.run('Hand & Foot Care', skinCareId);
    insertCategoryStmt.run('Aromatherapy', skinCareId);
    insertCategoryStmt.run('Baby Care', skinCareId);
    insertCategoryStmt.run("men's face wash", skinCareId);
    
    // Face Care subcategories
    const faceCareId = getCategoryIdStmt.get('Face Care')?.id;
    if (faceCareId) {
      const faceCareItems = [
        'Face Wash', 'Face Cleanser', 'Face Scrub & Exfoliator', 'Skin Toner',
        'Serum & Facial Oil', 'Face Pack, Mask, Peels', 'Face Cream - Moisturizers',
        'Bleacher', 'Suppliment & Capsule', 'Facial Kit', 'Sun Cream'
      ];
      faceCareItems.forEach(item => insertCategoryStmt.run(item, faceCareId));
    }
    
    // Eye Care subcategories
    const eyeCareId = getCategoryIdStmt.get('Eye Care')?.id;
    if (eyeCareId) {
      insertCategoryStmt.run('Eye Serum', eyeCareId);
      insertCategoryStmt.run('Eye Cream & Gel', eyeCareId);
    }
    
    // Lip Treatment subcategories
    const lipTreatmentId = getCategoryIdStmt.get('Lip Treatment')?.id;
    if (lipTreatmentId) {
      insertCategoryStmt.run('Lip Secrub', lipTreatmentId);
      insertCategoryStmt.run('Lip Balm & Care', lipTreatmentId);
    }
    
    // Body Care subcategories
    const bodyCareId = getCategoryIdStmt.get('Body Care')?.id;
    if (bodyCareId) {
      const bodyCareItems = [
        'Body Soap', 'Bath Salt', 'Body Scrub & Exforliants',
        'Body Lotion & Body Cream, Body Butter', 'Body & Massage Oil & Lotion',
        'Body Talc', 'Body Wash & Shower Gel', 'Hair Removal'
      ];
      bodyCareItems.forEach(item => insertCategoryStmt.run(item, bodyCareId));
    }
    
    // Hand & Foot Care subcategories
    const handFootId = getCategoryIdStmt.get('Hand & Foot Care')?.id;
    if (handFootId) {
      const handFootItems = ['Hand Wash & Soap', 'Hand Sanitizer', 'Hand Cream', 'Foot Care'];
      handFootItems.forEach(item => insertCategoryStmt.run(item, handFootId));
    }
    
    // Aromatherapy subcategories
    const aromaId = getCategoryIdStmt.get('Aromatherapy')?.id;
    if (aromaId) {
      insertCategoryStmt.run('Essential Oil', aromaId);
    }
    
    // Baby Care subcategories
    const babyCareId = getCategoryIdStmt.get('Baby Care')?.id;
    if (babyCareId) {
      insertCategoryStmt.run('Baby Need All', babyCareId);
    }
  }
  
  // ACCESSORIES subcategories
  const accessoriesId = getCategoryIdStmt.get('ACCESSORIES')?.id;
  if (accessoriesId) {
    insertCategoryStmt.run('Hair Accessories', accessoriesId);
    insertCategoryStmt.run('Bath Accessories', accessoriesId);
    insertCategoryStmt.run('Eye Accessories', accessoriesId);
    insertCategoryStmt.run('Nail Accessories', accessoriesId);
    insertCategoryStmt.run('Tools, Brushes & Accessories', accessoriesId);
    
    // Hair Accessories subcategories
    const hairAccId = getCategoryIdStmt.get('Hair Accessories')?.id;
    if (hairAccId) {
      insertCategoryStmt.run('Comb & Brusher', hairAccId);
      insertCategoryStmt.run('Hair Other Accessories', hairAccId);
    }
    
    // Bath Accessories subcategories
    const bathAccId = getCategoryIdStmt.get('Bath Accessories')?.id;
    if (bathAccId) {
      const bathAccItems = ['Loofah', 'Scrubber', 'Bath Set & More'];
      bathAccItems.forEach(item => insertCategoryStmt.run(item, bathAccId));
    }
    
    // Eye Accessories subcategories
    const eyeAccId = getCategoryIdStmt.get('Eye Accessories')?.id;
    if (eyeAccId) {
      insertCategoryStmt.run('False Eyelasher', eyeAccId);
      insertCategoryStmt.run('Contact Lenses', eyeAccId);
    }
    
    // Nail Accessories subcategories
    const nailAccId = getCategoryIdStmt.get('Nail Accessories')?.id;
    if (nailAccId) {
      const nailAccItems = ['Manicre & Pedicure Kits', 'Artificial Nails', 'Nail Care'];
      nailAccItems.forEach(item => insertCategoryStmt.run(item, nailAccId));
    }
    
    // Tools, Brushes & Accessories subcategories
    const toolsId = getCategoryIdStmt.get('Tools, Brushes & Accessories')?.id;
    if (toolsId) {
      const toolsItems = [
        'Sponges & Applicators', 'Face Brush', 'Eye Brush', 'Lip Brush',
        'Tweezers & Eye brow tools', 'Eye Lash Curlers', 'sharpener', 'Mirror',
        'Makeup Brush Cleaner', 'Makeup Brush', 'Makeup Box, Cosmetic Pouch'
      ];
      toolsItems.forEach(item => insertCategoryStmt.run(item, toolsId));
    }
  }
  
  // FRAGRANCE subcategories
  const fragranceId = getCategoryIdStmt.get('FRAGRANCE')?.id;
  if (fragranceId) {
    const fragranceItems = ['Perfume', 'Deodorant & roll-on', 'Talc', 'Body Mist'];
    fragranceItems.forEach(item => insertCategoryStmt.run(item, fragranceId));
  }
  
  // PERSONAL CARE subcategories
  const personalCareId = getCategoryIdStmt.get('PERSONAL CARE')?.id;
  if (personalCareId) {
    insertCategoryStmt.run('Dental care', personalCareId);
    insertCategoryStmt.run('Home & Health care', personalCareId);
    insertCategoryStmt.run('FACE STEAMERS', personalCareId);
  }
  
  // SALON EQUIPMENT subcategories
  const salonEquipId = getCategoryIdStmt.get('SALON EQUIPMENT')?.id;
  if (salonEquipId) {
    insertCategoryStmt.run('Clippers', salonEquipId);
  }
  
  // APPLIANCES subcategories
  const appliancesId = getCategoryIdStmt.get('APPLIANCES')?.id;
  if (appliancesId) {
    insertCategoryStmt.run('Hair Styling Tools', appliancesId);
    insertCategoryStmt.run('Hair Removal Tools', appliancesId);
    insertCategoryStmt.run('Shaving Tools', appliancesId);
    insertCategoryStmt.run('Face & Skin Tools', appliancesId);
    insertCategoryStmt.run('Massage Tools', appliancesId);
    insertCategoryStmt.run('Foot Care', appliancesId);
    
    // Hair Styling Tools subcategories
    const hairStylingId = getCategoryIdStmt.get('Hair Styling Tools')?.id;
    if (hairStylingId) {
      const hairStylingItems = [
        'Hair Dryers', 'Hair Straighteners', 'Hair Curling Iron/Stylers', 'Multi Stylers'
      ];
      hairStylingItems.forEach(item => insertCategoryStmt.run(item, hairStylingId));
    }
    
    // Hair Removal Tools subcategories
    const hairRemovalId = getCategoryIdStmt.get('Hair Removal Tools')?.id;
    if (hairRemovalId) {
      const hairRemovalItems = ['Epilators', 'Body Groomers', 'Bikini Trimmers'];
      hairRemovalItems.forEach(item => insertCategoryStmt.run(item, hairRemovalId));
    }
    
    // Shaving Tools subcategories
    const shavingId = getCategoryIdStmt.get('Shaving Tools')?.id;
    if (shavingId) {
      insertCategoryStmt.run('Shavers', shavingId);
      insertCategoryStmt.run('Trimmers', shavingId);
    }
    
    // Face & Skin Tools subcategories
    const faceSkinToolsId = getCategoryIdStmt.get('Face & Skin Tools')?.id;
    if (faceSkinToolsId) {
      const faceSkinToolsItems = [
        'Face Epilators', 'Dermarollers', 'Cleansing Brushes', 'Acne Removal'
      ];
      faceSkinToolsItems.forEach(item => insertCategoryStmt.run(item, faceSkinToolsId));
    }
    
    // Massage Tools subcategories
    const massageId = getCategoryIdStmt.get('Massage Tools')?.id;
    if (massageId) {
      insertCategoryStmt.run('Massagers', massageId);
    }
  }
};

// Close database connection properly
const closeDatabase = () => {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve();
      return;
    }

    try {
      db.close();
      db = null;
      isInitialized = false;
      resolve();
    } catch (err) {
      reject(err);
    }
  });
};

const getDatabase = () => {
  return db;
};

// Manual backup function (call when needed)
const backupDatabase = () => {
  if (!db) return null;
  
  const fs = require('fs');
  
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