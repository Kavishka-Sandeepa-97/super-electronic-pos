import React, { useState, useRef } from 'react';
import {
  Box,
  Button,
  Menu,
  MenuItem,
  ListItemText,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  Category as CategoryIcon,
} from '@mui/icons-material';

const CategoryMenu = ({ categories, selectedCategory, onCategorySelect }) => {
  const [mainAnchorEl, setMainAnchorEl] = useState(null);
  const [subMenuAnchors, setSubMenuAnchors] = useState({});
  const hoverTimerRef = useRef({});

  const handleMainClick = (event) => {
    setMainAnchorEl(event.currentTarget);
  };

  const handleMainClose = () => {
    setMainAnchorEl(null);
    setSubMenuAnchors({});
    // Clear all timers
    Object.values(hoverTimerRef.current).forEach(timer => clearTimeout(timer));
    hoverTimerRef.current = {};
  };

  const handleCategorySelect = (category) => {
    onCategorySelect(category);
    handleMainClose();
  };

  const handleSubMenuOpen = (event, categoryId) => {
    // Clear any existing timer for this category
    if (hoverTimerRef.current[categoryId]) {
      clearTimeout(hoverTimerRef.current[categoryId]);
    }
    
    setSubMenuAnchors(prev => ({
      ...prev,
      [categoryId]: event.currentTarget
    }));
  };

  const handleSubMenuClose = (categoryId) => {
    // Delay closing to prevent blinking
    hoverTimerRef.current[categoryId] = setTimeout(() => {
      setSubMenuAnchors(prev => {
        const newState = { ...prev };
        delete newState[categoryId];
        return newState;
      });
    }, 300);
  };

  const cancelClose = (categoryId) => {
    if (hoverTimerRef.current[categoryId]) {
      clearTimeout(hoverTimerRef.current[categoryId]);
      delete hoverTimerRef.current[categoryId];
    }
  };

  const renderMenuItem = (category) => {
    const hasSubcategories = category.subcategories && category.subcategories.length > 0;

    return (
      <div key={category.id}>
        <MenuItem
          onClick={(e) => {
            if (hasSubcategories) {
              handleSubMenuOpen(e, category.id);
            } else {
              handleCategorySelect(category);
            }
          }}
          onMouseEnter={(e) => {
            if (hasSubcategories) {
              cancelClose(category.id);
              handleSubMenuOpen(e, category.id);
            }
          }}
          onMouseLeave={() => {
            if (hasSubcategories) {
              handleSubMenuClose(category.id);
            }
          }}
          selected={selectedCategory === category.id}
          sx={{
            '&:hover': {
              backgroundColor: '#f5f5f5',
            },
            minWidth: 200,
          }}
        >
          <ListItemText 
            primary={category.name}
            primaryTypographyProps={{
              fontWeight: selectedCategory === category.id ? 600 : 400,
            }}
          />
          {hasSubcategories && <ChevronRightIcon sx={{ ml: 2 }} />}
        </MenuItem>

        {hasSubcategories && (
          <Menu
            anchorEl={subMenuAnchors[category.id]}
            open={Boolean(subMenuAnchors[category.id])}
            onClose={() => handleSubMenuClose(category.id)}
            anchorOrigin={{
              vertical: 'top',
              horizontal: 'right',
            }}
            transformOrigin={{
              vertical: 'top',
              horizontal: 'left',
            }}
            MenuListProps={{
              onMouseEnter: () => cancelClose(category.id),
              onMouseLeave: () => handleSubMenuClose(category.id),
            }}
            sx={{
              pointerEvents: 'none',
              '& .MuiPaper-root': {
                pointerEvents: 'auto',
                maxHeight: 500,
                overflowY: 'auto',
                minWidth: 250,
              },
            }}
          >
            {category.subcategories.map((subcat) => {
              const hasDeepSubs = subcat.subcategories && subcat.subcategories.length > 0;
              
              return (
                <div key={subcat.id}>
                  <MenuItem
                    onClick={(e) => {
                      if (hasDeepSubs) {
                        handleSubMenuOpen(e, subcat.id);
                      } else {
                        handleCategorySelect(subcat);
                      }
                    }}
                    onMouseEnter={(e) => {
                      if (hasDeepSubs) {
                        cancelClose(subcat.id);
                        handleSubMenuOpen(e, subcat.id);
                      }
                    }}
                    onMouseLeave={() => {
                      if (hasDeepSubs) {
                        handleSubMenuClose(subcat.id);
                      }
                    }}
                    selected={selectedCategory === subcat.id}
                    sx={{
                      '&:hover': {
                        backgroundColor: '#f5f5f5',
                      },
                    }}
                  >
                    <ListItemText 
                      primary={subcat.name}
                      primaryTypographyProps={{
                        fontWeight: selectedCategory === subcat.id ? 600 : 400,
                      }}
                    />
                    {hasDeepSubs && <ChevronRightIcon sx={{ ml: 2 }} />}
                  </MenuItem>

                  {hasDeepSubs && (
                    <Menu
                      anchorEl={subMenuAnchors[subcat.id]}
                      open={Boolean(subMenuAnchors[subcat.id])}
                      onClose={() => handleSubMenuClose(subcat.id)}
                      anchorOrigin={{
                        vertical: 'top',
                        horizontal: 'right',
                      }}
                      transformOrigin={{
                        vertical: 'top',
                        horizontal: 'left',
                      }}
                      MenuListProps={{
                        onMouseEnter: () => cancelClose(subcat.id),
                        onMouseLeave: () => handleSubMenuClose(subcat.id),
                      }}
                      sx={{
                        pointerEvents: 'none',
                        '& .MuiPaper-root': {
                          pointerEvents: 'auto',
                          maxHeight: 500,
                          overflowY: 'auto',
                          minWidth: 220,
                        },
                      }}
                    >
                      {subcat.subcategories.map((deepSubcat) => (
                        <MenuItem
                          key={deepSubcat.id}
                          onClick={() => handleCategorySelect(deepSubcat)}
                          selected={selectedCategory === deepSubcat.id}
                          sx={{
                            '&:hover': {
                              backgroundColor: '#f5f5f5',
                            },
                          }}
                        >
                          <ListItemText 
                            primary={deepSubcat.name}
                            primaryTypographyProps={{
                              fontWeight: selectedCategory === deepSubcat.id ? 600 : 400,
                            }}
                          />
                        </MenuItem>
                      ))}
                    </Menu>
                  )}
                </div>
              );
            })}
          </Menu>
        )}
      </div>
    );
  };

  return (
    <Box sx={{ 
      p: 2,
      borderBottom: '2px solid #f0f0f0',
    }}>
      <Button
        onClick={handleMainClick}
        variant="contained"
        endIcon={<ExpandMoreIcon />}
        startIcon={<CategoryIcon />}
        sx={{
          textTransform: 'uppercase',
          fontWeight: 700,
          fontSize: '1rem',
          px: 4,
          py: 1.5,
          borderRadius: 2,
          background: '#E53935',
          color: 'white',
          '&:hover': {
            background: '#C62828',
          },
        }}
      >
        Category
      </Button>

      <Menu
        anchorEl={mainAnchorEl}
        open={Boolean(mainAnchorEl)}
        onClose={handleMainClose}
        MenuListProps={{
          'aria-labelledby': 'category-button',
        }}
        sx={{
          '& .MuiPaper-root': {
            minWidth: 220,
            maxHeight: 500,
            overflowY: 'auto',
          },
        }}
      >
        <MenuItem
          onClick={() => handleCategorySelect(null)}
          selected={selectedCategory === null}
          sx={{
            fontWeight: selectedCategory === null ? 700 : 400,
            '&:hover': {
              backgroundColor: '#f5f5f5',
            },
          }}
        >
          <ListItemText primary="All Categories" />
        </MenuItem>
        
        {categories.map((category) => renderMenuItem(category))}
      </Menu>
    </Box>
  );
};

export default CategoryMenu;
