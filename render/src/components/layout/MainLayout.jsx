import React, { useState, useRef, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Box,
  Drawer,
  List,
  Typography,
  Divider,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Menu,
  MenuItem,
  Button,
  Tooltip,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  InputAdornment,
} from '@mui/material';
import {
  PointOfSale,
  Inventory,
  Receipt,
  Analytics,
  Settings,
  Logout,
  Person,
  AccountBalanceWallet,
  PlayArrow,
  Stop,
  Refresh,
  
  Restaurant,
  Warehouse,
} from '@mui/icons-material';
import { logout } from '../../store/slices/authSlice';
import { setSidebarOpen, setCurrentView } from '../../store/slices/uiSlice';
import { closeCashierShift, openCashierShift, fetchActiveShift } from '../../store/slices/cashierShiftSlice';
import { setActiveShift, clearActiveShift } from '../../store/slices/authSlice';

const drawerWidth = 280;
const collapsedWidth = 70;

const MainLayout = ({ children }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  
  const { user, activeShift } = useSelector((state) => state.auth);
  const { sidebarOpen, notifications } = useSelector((state) => state.ui);
  
  const [anchorEl, setAnchorEl] = useState(null);
  // Hover collapse timeout ref
  const hoverTimeoutRef = useRef(null);
  // Track whether mouse is currently over the drawer
  const isHoveringRef = useRef(false);
  // Track whether profile menu is open to prevent collapse while open
  const menuOpenRef = useRef(false);

  // Shift management state
  const [openShiftDialog, setOpenShiftDialog] = useState(false);
  const [closeShiftDialog, setCloseShiftDialog] = useState(false);
  const [shiftAmount, setShiftAmount] = useState('');
  const [shiftDescription, setShiftDescription] = useState('');

  // Enter: cancel pending collapse and open
  const handleMouseEnter = () => {
    isHoveringRef.current = true;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    dispatch(setSidebarOpen(true));
  };

  // Leave: add a small delay before collapsing to avoid flicker
  const handleMouseLeave = () => {
    isHoveringRef.current = false;
    // Don't collapse if the profile menu is open
    if (menuOpenRef.current) return;

    // 300ms delay (tweakable)
    hoverTimeoutRef.current = setTimeout(() => {
      dispatch(setSidebarOpen(false));
      hoverTimeoutRef.current = null;
    }, 300);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
    };
  }, []);

  const menuItems = [
    { type: 'item', text: 'Point of Sale', icon: <PointOfSale />, path: '/pos', view: 'pos' },
    { type: 'item', text: 'Inventory', icon: <Inventory />, path: '/inventory', view: 'inventory' },
    { type: 'item', text: 'In/Out Management', icon: <Receipt />, path: '/inout', view: 'inout' },
    { type: 'item', text: 'POS Reports', icon: <Analytics />, path: '/reports', view: 'reports' },
    { type: 'divider' },
    { type: 'item', text: 'Stock Management', icon: <Warehouse />, path: '/stock', view: 'stock' },
    { type: 'item', text: 'Stock Report', icon: <Analytics />, path: '/stock-report', view: 'stock-report' },
    { type: 'divider' },
    { type: 'item', text: 'Settings', icon: <Settings />, path: '/settings', view: 'settings' },
  ];

  const handleMenuClick = (event) => {
    setAnchorEl(event.currentTarget);
    // mark menu as open to prevent sidebar collapsing while menu is visible
    menuOpenRef.current = true;
    // ensure sidebar stays open and cancel any pending collapse
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    dispatch(setSidebarOpen(true));
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    // mark menu as closed and collapse if mouse is not over drawer
    menuOpenRef.current = false;
    if (!isHoveringRef.current) {
      hoverTimeoutRef.current = setTimeout(() => {
        dispatch(setSidebarOpen(false));
        hoverTimeoutRef.current = null;
      }, 300);
    }
  };

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login');
    handleMenuClose();
  };

  // Shift management functions
  const handleOpenShift = () => {
    setOpenShiftDialog(true);
    handleMenuClose();
  };

  const handleCloseShift = () => {
    setCloseShiftDialog(true);
    handleMenuClose();
  };

  const handleConfirmOpenShift = async () => {
    const amount = parseFloat(shiftAmount);
    if (isNaN(amount) || amount < 0) {
      alert('Please enter a valid amount');
      return;
    }

    try {
      const result = await dispatch(openCashierShift({
        user_id: user.id,
        initial_cash_onhand: amount,
        description: shiftDescription.trim() || 'Shift opened',
      }));

      if (result.type === 'cashierShift/open/fulfilled') {
        dispatch(setActiveShift(result.payload));
        setOpenShiftDialog(false);
        setShiftAmount('');
        setShiftDescription('');
      }
    } catch (error) {
      console.error('Error opening shift:', error);
      alert('Failed to open shift. Please try again.');
    }
  };

  const handleConfirmCloseShift = async () => {
    try {
      const result = await dispatch(closeCashierShift({
        id: activeShift.id,
        closeData: {
          current_cash_onhand: activeShift?.current_cash_onhand || 0,
          description: shiftDescription.trim() || 'Shift closed',
        },
      }));

      if (result.type === 'cashierShift/close/fulfilled') {
        dispatch(clearActiveShift());
        setCloseShiftDialog(false);
        setShiftAmount('');
        setShiftDescription('');
      }
    } catch (error) {
      console.error('Error closing shift:', error);
      alert('Failed to close shift. Please try again.');
    }
  };

  const handleRefreshCash = async () => {
    if (!user?.id) return;
    
    try {
      const result = await dispatch(fetchActiveShift(user.id));
      if (result.type === 'cashierShift/fetchActive/fulfilled') {
        dispatch(setActiveShift(result.payload));
      }
    } catch (error) {
      console.error('Error refreshing cash:', error);
    }
  };

  const handleNavigation = (path, view) => {
    navigate(path);
    dispatch(setCurrentView(view));
  };

  const isActive = (path) => location.pathname === path;

  return (
    <Box sx={{ display: 'flex' }}>
      {/* Sidebar */}
      <Drawer
        variant="permanent"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        sx={{
          width: sidebarOpen ? drawerWidth : collapsedWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: sidebarOpen ? drawerWidth : collapsedWidth,
            boxSizing: 'border-box',
            transition: 'width 300ms cubic-bezier(0.4, 0, 0.2, 1)',
            overflowX: 'hidden',
            background: 'linear-gradient(180deg, #2C3E50 0%, #34495E 100%)',
            color: 'white',
            borderRight: 'none',
            boxShadow: '4px 0 20px rgba(0,0,0,0.1)',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
          },
        }}
      >
        {/* Logo + Profile */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: sidebarOpen ? 'space-between' : 'center',
            padding: 2,
            minHeight: 64,
            background: 'rgba(0,0,0,0.2)',
          }}
        >
          {sidebarOpen ? (
            <Box sx={{ display: 'flex', flexDirection: 'column',width: '100%' }}>
              {/* First row: Name and Profile Icon */}            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography
                  variant="body1"
                  sx={{
                    fontWeight: 'bold',
                    background: 'linear-gradient(45deg, #4ECDC4, #44A08D)',
                    backgroundClip: 'text',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  {user?.name || 'User'}
                </Typography>
                <Tooltip title="Account settings">
                  <IconButton onClick={handleMenuClick} sx={{ p: 0 }}>
                    <Avatar
                      sx={{
                        bgcolor: 'rgba(255,255,255,0.15)',
                        color: 'white',
                        border: '2px solid rgba(255,255,255,0.12)',
                        width: 36,
                        height: 36,
                      }}
                    >
                      {user?.name?.charAt(0)?.toUpperCase() || 'U'}
                    </Avatar>
                  </IconButton>
                </Tooltip>
              </Box>
              
              {/* Second row: Cash Display for Cashiers */}
              {user?.role === 'cashier' && (
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <AccountBalanceWallet sx={{ fontSize: 16, mr: 0.5, color: '#4ECDC4' }} />
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.9)', mr: 0.5 }}>
                    Rs. {activeShift ? activeShift.current_cash_onhand?.toFixed(2) : '0.00'}
                  </Typography>
                  <Tooltip title="Refresh cash on hand">
                    <IconButton 
                      onClick={handleRefreshCash} 
                      size="small" 
                      sx={{ p: 0.5, color: 'rgba(255,255,255,0.7)', '&:hover': { color: 'white' } }}
                    >
                      <Refresh sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
            </Box>
          ) : (
            <Tooltip title="Account settings">
              <IconButton onClick={handleMenuClick} sx={{ p: 0 }}>
                <Avatar
                  sx={{
                    bgcolor: 'rgba(255,255,255,0.15)',
                    color: 'white',
                    border: '2px solid rgba(255,255,255,0.12)',
                    width: 36,
                    height: 36,
                  }}
                >
                  {user?.name?.charAt(0)?.toUpperCase() || 'U'}
                </Avatar>
              </IconButton>
            </Tooltip>
          )}
          
        </Box>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.1)' }} />

        {/* Navigation Menu */}
        <List sx={{ pt: 1, flexGrow: 1 }}>
          {menuItems.map((item, index) => (
            item.type === 'divider' ? (
              <Divider key={index} sx={{ borderColor: 'rgba(255,255,255,0.1)' }} />
            ) : (
              <ListItem key={item.text} disablePadding sx={{ display: 'block' }}>
                <Tooltip title={!sidebarOpen ? item.text : ''} placement="right">
                  <ListItemButton
                    onClick={() => handleNavigation(item.path, item.view)}
                    sx={{
                      minHeight: 48,
                      justifyContent: sidebarOpen ? 'initial' : 'center',
                      px: 2.5,
                      mx: 1,
                      my: 0.5,
                      borderRadius: 2,
                      backgroundColor: isActive(item.path) ? 'rgba(76, 205, 196, 0.2)' : 'transparent',
                      borderLeft: isActive(item.path) ? '4px solid #4ECDC4' : '4px solid transparent',
                      '&:hover': {
                        backgroundColor: 'rgba(76, 205, 196, 0.1)',
                        transform: 'translateX(4px)',
                      },
                      transition: 'background-color 240ms, transform 240ms',
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: 0,
                        mr: sidebarOpen ? 3 : 0,
                        justifyContent: 'center',
                        color: isActive(item.path) ? '#4ECDC4' : 'rgba(255,255,255,0.7)',
                        transition: 'margin 300ms cubic-bezier(0.4,0,0.2,1), color 300ms',
                      }}
                    >
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={item.text}
                      sx={{
                        opacity: sidebarOpen ? 1 : 0,
                        transform: sidebarOpen ? 'translateX(0)' : 'translateX(-8px)',
                        transition: 'opacity 300ms cubic-bezier(0.4,0,0.2,1), transform 300ms cubic-bezier(0.4,0,0.2,1)',
                        color: isActive(item.path) ? '#4ECDC4' : 'rgba(255,255,255,0.9)',
                        '& .MuiTypography-root': {
                          fontWeight: isActive(item.path) ? 600 : 400,
                        },
                        whiteSpace: 'nowrap',
                      }}
                    />
                  </ListItemButton>
                </Tooltip>
              </ListItem>
            )
          ))}
        </List>

        {/* Logo at bottom */}
        <ListItem disablePadding sx={{ display: 'block' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: sidebarOpen ? 'flex-start' : 'center', px: 2.5, mx: 1, my: 0.5 }}>
            <Restaurant sx={{ fontSize: 32, color: '#4ECDC4' }} />
            {sidebarOpen && (
              <Typography
                variant="h6"
                sx={{
                  ml: 1,
                  fontWeight: 'bold',
                  background: 'linear-gradient(45deg, #4ECDC4, #44A08D)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                BINTHANNA
              </Typography>
            )}
          </Box>
        </ListItem>
      </Drawer>

      {/* Profile Menu (anchored to sidebar avatar) */}
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        PaperProps={{
          elevation: 8,
          sx: {
            overflow: 'visible',
            filter: 'drop-shadow(0px 2px 8px rgba(0,0,0,0.32))',
            mt: 1.5,
            minWidth: 200,
            '& .MuiAvatar-root': {
              width: 32,
              height: 32,
              ml: -0.5,
              mr: 1,
            },
            '&:before': {
              content: '""',
              display: 'block',
              position: 'absolute',
              top: 0,
              right: 14,
              width: 10,
              height: 10,
              bgcolor: 'background.paper',
              transform: 'translateY(-50%) rotate(45deg)',
              zIndex: 0,
            },
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
      >
        <MenuItem>
          <Avatar />
          <Box>
            <Typography variant="subtitle2">{user?.name || 'User'}</Typography>
            <Chip
              label={user?.role || 'Staff'}
              size="small"
              color={user?.role === 'admin' ? 'primary' : 'default'}
              sx={{ fontSize: '0.7rem' }}
            />
          </Box>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { navigate('/settings?tab=profile'); handleMenuClose(); }}>
          <Person fontSize="small" sx={{ mr: 1 }} />
          Profile
        </MenuItem>
        
        {/* Cashier Shift Management */}
        {user?.role === 'cashier' && (
          <>
            <Divider />
            {activeShift ? (
              <MenuItem onClick={handleCloseShift} sx={{ color: 'warning.main' }}>
                <Stop fontSize="small" sx={{ mr: 1 }} />
                Close Shift
              </MenuItem>
            ) : (
              <MenuItem onClick={handleOpenShift} sx={{ color: 'success.main' }}>
                <PlayArrow fontSize="small" sx={{ mr: 1 }} />
                Open Shift
              </MenuItem>
            )}
          </>
        )}
        
        <Divider />
        <MenuItem onClick={() => { handleLogout(); }} sx={{ color: 'error.main' }}>
          <Logout fontSize="small" sx={{ mr: 1 }} />
          Logout
        </MenuItem>
      </Menu>

      {/* Main Content (no navbar) */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          bgcolor: '#f5f7fa',
          minHeight: '100vh',
        }}
      >
        <Box sx={{ p: 3 }}>{children}</Box>
      </Box>

      {/* Shift Management Dialogs */}
      <Dialog open={openShiftDialog} onClose={() => setOpenShiftDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Open Cashier Shift</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Initial Cash Amount"
            type="number"
            fullWidth
            value={shiftAmount}
            onChange={(e) => setShiftAmount(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start"></InputAdornment>,
            }}
          />
          <TextField
            margin="dense"
            label="Description (Optional)"
            fullWidth
            value={shiftDescription}
            onChange={(e) => setShiftDescription(e.target.value)}
            placeholder="Starting cash for the shift"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenShiftDialog(false)}>Cancel</Button>
          <Button onClick={handleConfirmOpenShift} variant="contained">Open Shift</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={closeShiftDialog} onClose={() => setCloseShiftDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Close Cashier Shift</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Current cash: {activeShift?.current_cash_onhand?.toFixed(2) || '0.00'}
          </Typography>
          <Typography variant="body2" color="warning.main" sx={{ mb: 2, fontStyle: 'italic' }}>
            The system will automatically use the current cash amount on hand for closing.
          </Typography>
          <TextField
            margin="dense"
            label="Description (Optional)"
            fullWidth
            value={shiftDescription}
            onChange={(e) => setShiftDescription(e.target.value)}
            placeholder="Reason for closing shift or notes"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCloseShiftDialog(false)}>Cancel</Button>
          <Button onClick={handleConfirmCloseShift} variant="contained" color="warning">Close Shift</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MainLayout;