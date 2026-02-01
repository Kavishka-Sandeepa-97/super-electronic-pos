# Restaurant POS System - API Documentation

## Overview
This is a comprehensive REST API for a restaurant POS system built with Express.js and SQLite, following the provided ER diagram.

## Database Schema
The system implements the following entities:
- **Staff** - User management with roles (admin/cashier)
- **Category** - Product categories
- **Item** - Menu items
- **Variant** - Item variants (sizes, types, etc.)
- **Item Variant** - Specific item variants with barcodes
- **Order** - Customer orders
- **Item Variant Order** - Order line items
- **Stock Batch** - Inventory management
- **Sell Price History** - Price tracking

## API Endpoints

### Staff Management
- `GET /api/staff` - Get all staff members
- `GET /api/staff/:id` - Get staff by ID
- `POST /api/staff` - Create new staff member
- `PUT /api/staff/:id` - Update staff member
- `DELETE /api/staff/:id` - Delete staff member
- `POST /api/staff/login` - Staff login with PIN

### Category Management
- `GET /api/categories` - Get all categories
- `GET /api/categories/:id` - Get category by ID
- `POST /api/categories` - Create new category
- `PUT /api/categories/:id` - Update category
- `DELETE /api/categories/:id` - Delete category
- `GET /api/categories/:id/items` - Get items in category

### Item Management
- `GET /api/items` - Get all items with category info
- `GET /api/items/:id` - Get item by ID with variants
- `POST /api/items` - Create new item
- `PUT /api/items/:id` - Update item
- `DELETE /api/items/:id` - Delete item
- `GET /api/items/search/:query` - Search items

### Variant Management
- `GET /api/variants` - Get all variants
- `GET /api/variants/:id` - Get variant by ID
- `POST /api/variants` - Create new variant
- `PUT /api/variants/:id` - Update variant
- `DELETE /api/variants/:id` - Delete variant

### Item Variant Management
- `GET /api/item-variants` - Get all item variants with details
- `GET /api/item-variants/:id` - Get item variant by ID
- `POST /api/item-variants` - Create new item variant
- `PUT /api/item-variants/:id` - Update item variant
- `DELETE /api/item-variants/:id` - Delete item variant
- `GET /api/item-variants/barcode/:barcode` - Search by barcode
- `POST /api/item-variants/:id/price` - Set selling price

### Order Management
- `GET /api/orders` - Get all orders (with filters)
- `GET /api/orders/:id` - Get order by ID with items
- `POST /api/orders` - Create new order
- `PUT /api/orders/:id/status` - Update order status
- `GET /api/orders/reports/daily` - Daily sales report

### Stock Management
- `GET /api/stock` - Get all stock batches
- `GET /api/stock/:id` - Get stock batch by ID
- `POST /api/stock` - Create new stock batch (add inventory)
- `PUT /api/stock/:id` - Update stock batch
- `PUT /api/stock/:id/adjust` - Adjust stock quantity
- `GET /api/stock/summary/by-item` - Stock summary by item
- `GET /api/stock/alerts/low-stock` - Low stock alerts
- `GET /api/stock/movements/:item_variant_id` - Stock movement history

## Features Implemented

### ✅ Database Structure
- Complete SQLite schema based on ER diagram
- Foreign key relationships
- Data validation and constraints
- Default data seeding

### ✅ Authentication
- Staff login with PIN
- Role-based access (admin/cashier)
- User management

### ✅ Product Management
- Categories and items
- Variants and item variants
- Barcode support
- Image support for items

### ✅ Inventory Management
- Stock batches with buy prices
- Stock adjustments
- Low stock alerts
- Stock movement tracking

### ✅ Order Processing
- Complete order creation
- Order status management
- Discount support (fixed/percentage)
- Automatic stock deduction

### ✅ Reporting
- Daily sales reports
- Top selling items
- Stock summaries
- Movement history

### ✅ Error Handling
- Comprehensive error responses
- Data validation
- Relationship integrity checks

## Default Data
- Default admin user: PIN `1234`
- Default categories: Liquor, Beverages, Hot Meals, Desserts, Snacks, Tobacco, Other

## Next Steps for Frontend Integration
1. Update React components to use new API endpoints
2. Implement authentication flow
3. Create product management interface
4. Build order processing UI
5. Add inventory management screens
6. Implement reporting dashboard

## Hardware Integration Ready
The API is structured to support:
- Cash drawer integration
- QR code scanner (barcode lookup)
- Receipt printing
- Kitchen display systems

## Testing
Use the health check endpoint: `GET /api/health`

All endpoints return JSON responses with appropriate HTTP status codes.