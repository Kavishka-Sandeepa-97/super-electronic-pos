import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { ordersAPI } from '../../services/api';
import { fetchActiveShift } from './cashierShiftSlice';
import { setActiveShift } from './authSlice';
import { cashierShiftAPI } from '../../services/api';

// Async thunks for order operations
export const fetchActiveOrders = createAsyncThunk(
  'orders/fetchActiveOrders',
  async (_, { rejectWithValue }) => {
    try {
      const response = await ordersAPI.getActive();
      // Handle new API response format with pagination
      return response.orders || response || [];
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const createOrder = createAsyncThunk(
  'orders/createOrder',
  async (orderData, { rejectWithValue, getState }) => {
    try {
      // Check if user has active cashier shift (only for cashiers)
      const { auth } = getState();
      if (auth.user?.role === 'cashier' && !auth.activeShift) {
        return rejectWithValue('You must open a cashier shift before processing orders. Please open a shift from your profile menu.');
      }

      const response = await ordersAPI.create(orderData);
      return response;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const updateOrder = createAsyncThunk(
  'orders/updateOrder',
  async ({ orderId, orderData }, { rejectWithValue, getState }) => {
    try {
      // Check if user has active cashier shift (only for cashiers)
      const { auth } = getState();
      if (auth.user?.role === 'cashier' && !auth.activeShift) {
        return rejectWithValue('You must open a cashier shift before processing orders. Please open a shift from your profile menu.');
      }

      const response = await ordersAPI.update(orderId, orderData);
      return response;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

export const updateOrderStatus = createAsyncThunk(
  'orders/updateOrderStatus',
  async ({ orderId, status }, { rejectWithValue }) => {
    try {
      const response = await ordersAPI.updateStatus(orderId, status);
      return response;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

const orderSlice = createSlice({
  name: 'order',
  initialState: {
    currentOrder: {
      id: null, // null for new order, or the ID of a loaded active order
      items: [],
      subtotal: 0,
      discount: 0,
      additionalCharges: 0,
      total: 0,
      customerName: '',
      orderType: 'dine-in', // dine-in, takeaway
    },
    activeOrders: [],
    orderHistory: [],
    loading: false,
    error: null,
  },
  reducers: {
    loadOrderForEdit: (state, action) => {
      const order = action.payload;
      // Load the order into currentOrder for editing
      state.currentOrder = {
        id: order.id,
        items: (order.items || []).map(item => ({
          itemVariantId: item.item_variant_id,
          itemName: item.item_name,
          variantName: item.variant_name,
          price: parseFloat(item.price || item.unit_price),
          originalPrice: parseFloat(item.original_price || item.price || item.unit_price),
          quantity: parseFloat(item.quantity || item.qty),
          total: parseFloat(item.quantity || item.qty) * parseFloat(item.price || item.unit_price),
          barcode: item.barcode,
          discountSource: item.discount_source || null,
          discountType: item.item_discount_type || item.discount_type || null,
          discountValue: parseFloat(item.item_discount_value || item.discount_value || 0),
          discountAmount: parseFloat(item.item_discount_amount || item.discount_amount || 0),
        })),
        subtotal: (order.items || []).reduce((sum, item) => {
          return sum + (parseFloat(item.quantity || item.qty) * parseFloat(item.price || item.unit_price));
        }, 0),
        discount: parseFloat(order.discount_value || 0),
        additionalCharges: parseFloat(order.additional_charges || 0),
        total: parseFloat(order.total_amount || 0),
        customerName: order.customer_name || '',
        orderType: order.order_type || 'dine-in',
        isEditing: true, // Flag to indicate this is an edit
        originalStatus: order.status, // Store original status
      };
    },
    addItemToOrder: (state, action) => {
      const { itemVariant, quantity = 1, globalDiscountSettings, preferredBatchId = null } = action.payload;
      const existingItem = state.currentOrder.items.find(
        item => item.itemVariantId === itemVariant.id
      );

      if (existingItem) {
        existingItem.quantity += quantity;
        existingItem.total = existingItem.quantity * existingItem.price;
      } else {
        // Ensure price is a valid number
        const originalPrice = parseFloat(itemVariant.selling_price || itemVariant.sellingPrice);
        const validOriginalPrice = isNaN(originalPrice) ? 0 : originalPrice;
        
        // Determine discount priority:
        // If global discount is active → no item/brand discounts for any item
        // If global is OFF → item discount > brand discount
        let discountSource = null;
        let discountType = null;
        let discountValue = 0;
        let discountAmount = 0;
        let finalPrice = validOriginalPrice;

        const globalActive = globalDiscountSettings && globalDiscountSettings.is_global_discount_active && parseFloat(globalDiscountSettings.global_discount_value) > 0;

        if (globalActive) {
          // Global discount is ON - no per-item discounts, global applies at order level
          finalPrice = validOriginalPrice;
        } else if (itemVariant.is_discount_active && itemVariant.discount_type && parseFloat(itemVariant.discount_value) > 0) {
          // Item-level discount (highest priority when global is OFF)
          discountSource = 'item';
          discountType = itemVariant.discount_type;
          discountValue = parseFloat(itemVariant.discount_value);
          if (discountType === 'percentage') {
            discountAmount = Math.round((validOriginalPrice * discountValue / 100) * 100) / 100;
          } else {
            discountAmount = discountValue;
          }
          finalPrice = Math.max(0, validOriginalPrice - discountAmount);
        } else if (itemVariant.brand_discount_active && itemVariant.brand_discount_type && parseFloat(itemVariant.brand_discount_value) > 0) {
          // Brand-level discount (second priority when global is OFF)
          discountSource = 'brand';
          discountType = itemVariant.brand_discount_type;
          discountValue = parseFloat(itemVariant.brand_discount_value);
          if (discountType === 'percentage') {
            discountAmount = Math.round((validOriginalPrice * discountValue / 100) * 100) / 100;
          } else {
            discountAmount = discountValue;
          }
          finalPrice = Math.max(0, validOriginalPrice - discountAmount);
        }

        state.currentOrder.items.push({
          itemVariantId: itemVariant.id,
          itemName: itemVariant.item_name || itemVariant.itemName,
          variantName: itemVariant.variant_name || itemVariant.variantName,
          price: finalPrice,
          originalPrice: validOriginalPrice,
          quantity,
          total: finalPrice * quantity,
          category: itemVariant.category_name || itemVariant.categoryName,
          discountSource,
          discountType,
          discountValue,
          discountAmount,
          // Store raw discount info for recalculation
          itemDiscountActive: !!itemVariant.is_discount_active,
          itemDiscountType: itemVariant.discount_type,
          itemDiscountValue: parseFloat(itemVariant.discount_value) || 0,
          brandDiscountActive: !!itemVariant.brand_discount_active,
          brandDiscountType: itemVariant.brand_discount_type,
          brandDiscountValue: parseFloat(itemVariant.brand_discount_value) || 0,
          preferredBatchId: preferredBatchId || null,
        });
      }

      // Recalculate totals
      state.currentOrder.subtotal = state.currentOrder.items.reduce(
        (sum, item) => {
          const itemTotal = parseFloat(item.total);
          return sum + (isNaN(itemTotal) ? 0 : itemTotal);
        }, 0
      );
      state.currentOrder.total = 
        state.currentOrder.subtotal + 
        state.currentOrder.additionalCharges - 
        state.currentOrder.discount;
    },
    removeItemFromOrder: (state, action) => {
      const itemVariantId = action.payload;
      state.currentOrder.items = state.currentOrder.items.filter(
        item => item.itemVariantId !== itemVariantId
      );

      // Recalculate totals
      state.currentOrder.subtotal = state.currentOrder.items.reduce(
        (sum, item) => {
          const itemTotal = parseFloat(item.total);
          return sum + (isNaN(itemTotal) ? 0 : itemTotal);
        }, 0
      );
      state.currentOrder.total = 
        state.currentOrder.subtotal + 
        state.currentOrder.additionalCharges - 
        state.currentOrder.discount;
    },
    updateItemQuantity: (state, action) => {
      const { itemVariantId, quantity } = action.payload;
      const item = state.currentOrder.items.find(
        item => item.itemVariantId === itemVariantId
      );

      if (item && quantity > 0) {
        item.quantity = quantity;
        // Ensure price is a valid number
        const price = parseFloat(item.price);
        const validPrice = isNaN(price) ? 0 : price;
        item.price = validPrice; // Update with valid price
        item.total = item.quantity * validPrice;

        // Recalculate totals
        state.currentOrder.subtotal = state.currentOrder.items.reduce(
          (sum, item) => {
            const itemTotal = parseFloat(item.total);
            return sum + (isNaN(itemTotal) ? 0 : itemTotal);
          }, 0
        );
        state.currentOrder.total = 
          state.currentOrder.subtotal + 
          state.currentOrder.additionalCharges - 
          state.currentOrder.discount;
      }
    },
    setDiscount: (state, action) => {
      state.currentOrder.discount = action.payload;
      state.currentOrder.total = 
        state.currentOrder.subtotal + 
        state.currentOrder.additionalCharges - 
        state.currentOrder.discount;
    },
    resetItemDiscount: (state, action) => {
      const itemVariantId = action.payload;
      const item = state.currentOrder.items.find(
        item => item.itemVariantId === itemVariantId
      );
      if (item) {
        const origPrice = item.originalPrice != null ? item.originalPrice : item.price;
        item.price = origPrice;
        item.discountSource = null;
        item.discountType = null;
        item.discountValue = 0;
        item.discountAmount = 0;
        item.total = item.quantity * origPrice;

        // Recalculate totals
        state.currentOrder.subtotal = state.currentOrder.items.reduce(
          (sum, item) => {
            const itemTotal = parseFloat(item.total);
            return sum + (isNaN(itemTotal) ? 0 : itemTotal);
          }, 0
        );
        state.currentOrder.total = 
          state.currentOrder.subtotal + 
          state.currentOrder.additionalCharges - 
          state.currentOrder.discount;
      }
    },
    updateItemDiscount: (state, action) => {
      const { itemVariantId, discountType, discountValue } = action.payload;
      const item = state.currentOrder.items.find(
        item => item.itemVariantId === itemVariantId
      );
      if (item) {
        const originalPrice = item.originalPrice || item.price;
        let discountAmount = 0;
        if (discountType === 'percentage') {
          discountAmount = Math.round((originalPrice * discountValue / 100) * 100) / 100;
        } else if (discountType === 'fixed') {
          discountAmount = discountValue;
        }
        item.discountSource = 'manual';
        item.discountType = discountType;
        item.discountValue = discountValue;
        item.discountAmount = discountAmount;
        item.price = Math.max(0, originalPrice - discountAmount);
        item.total = item.quantity * item.price;

        // Recalculate totals
        state.currentOrder.subtotal = state.currentOrder.items.reduce(
          (sum, item) => {
            const itemTotal = parseFloat(item.total);
            return sum + (isNaN(itemTotal) ? 0 : itemTotal);
          }, 0
        );
        state.currentOrder.total = 
          state.currentOrder.subtotal + 
          state.currentOrder.additionalCharges - 
          state.currentOrder.discount;
      }
    },
    setAdditionalCharges: (state, action) => {
      state.currentOrder.additionalCharges = action.payload;
      state.currentOrder.total = 
        state.currentOrder.subtotal + 
        state.currentOrder.additionalCharges - 
        state.currentOrder.discount;
    },
    setCustomerInfo: (state, action) => {
      const { customerName, orderType } = action.payload;
      state.currentOrder.customerName = customerName || '';
      state.currentOrder.orderType = orderType || 'dine-in';
    },
    clearCurrentOrder: (state) => {
      state.currentOrder = {
        id: null,
        items: [],
        subtotal: 0,
        discount: 0,
        additionalCharges: 0,
        total: 0,
        customerName: '',
        orderType: 'dine-in',
      };
    },
    loadActiveOrder: (state, action) => {
      // Load an existing active order into currentOrder
      const order = action.payload;
      state.currentOrder = {
        id: order.id,
        items: (order.items || []).map(item => ({
          itemVariantId: item.item_variant_id,
          itemName: item.item_name,
          variantName: item.variant_name,
          price: parseFloat(item.sell_price || item.unit_price || 0),
          quantity: item.qty,
          total: parseFloat(item.sell_price || item.unit_price || 0) * item.qty,
          category: item.category_name || '',
        })),
        subtotal: parseFloat(order.total_amount || 0) - parseFloat(order.additional_charges || 0) + parseFloat(order.discount_value || 0),
        discount: parseFloat(order.discount_value || 0),
        additionalCharges: parseFloat(order.additional_charges || 0),
        total: parseFloat(order.total_amount || 0),
        customerName: order.customer_name || '',
        orderType: 'dine-in',
      };
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch active orders
      .addCase(fetchActiveOrders.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchActiveOrders.fulfilled, (state, action) => {
        state.loading = false;
        state.activeOrders = action.payload;
      })
      .addCase(fetchActiveOrders.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Create order
      .addCase(createOrder.pending, (state) => {
        state.loading = true;
      })
      .addCase(createOrder.fulfilled, (state, action) => {
        state.loading = false;
        state.activeOrders.push(action.payload);
        // Clear current order after successful creation
        state.currentOrder = {
          id: null,
          items: [],
          subtotal: 0,
          discount: 0,
          additionalCharges: 0,
          total: 0,
          customerName: '',
          orderType: 'dine-in',
        };
      })
      .addCase(createOrder.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      // Update order status
      .addCase(updateOrderStatus.fulfilled, (state, action) => {
        // action.meta.arg contains the original arguments passed to the thunk
        const { orderId, status } = action.meta.arg;
        const index = state.activeOrders.findIndex(
          order => order.id === orderId
        );
        if (index !== -1) {
          if (status === 'completed' || status === 'cancelled') {
            state.activeOrders.splice(index, 1);
          } else {
            state.activeOrders[index].status = status;
          }
        }
      });
  },
});

export const {
  loadOrderForEdit,
  addItemToOrder,
  removeItemFromOrder,
  updateItemQuantity,
  setDiscount,
  resetItemDiscount,
  updateItemDiscount,
  setAdditionalCharges,
  setCustomerInfo,
  clearCurrentOrder,
  loadActiveOrder,
  clearError,
} = orderSlice.actions;

export default orderSlice.reducer;