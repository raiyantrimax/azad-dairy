import React, { useMemo, useState, useEffect } from 'react';
import {
  Alert,
  BackHandler,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
} from 'react-native';
import * as Location from 'expo-location';

type TabName = 'Home' | 'Products' | 'Cart' | 'Profile';
type CategoryName = 'All' | 'Milk' | 'Curd' | 'Ghee' | 'Paneer' | 'Sweets';
type AddressType = 'Home' | 'Office' | 'Other';

type Product = {
  id: number;
  name: string;
  category: Exclude<CategoryName, 'All'>;
  price: number;
  unit: string;
  description: string;
  rating: number;
  image: string;
  tag: string;
};

type CartItem = Product & {
  quantity: number;
};

type Address = {
  id: number;
  label: AddressType;
  area: string;
  line: string;
  isDefault?: boolean;
};

const sliderData = [
  {
    id: 1,
    title: 'Fresh morning delivery',
    subtitle: 'Farm fresh milk & dairy essentials',
    color: '#F7D777',
    icon: '🥛',
  },
  {
    id: 2,
    title: 'Weekend combo pack',
    subtitle: 'Save up to 20% on family essentials',
    color: '#C5F0D0',
    icon: '🧺',
  },
  {
    id: 3,
    title: 'Subscribe & save',
    subtitle: 'Weekly milk subscription with timing',
    color: '#F7BCD4',
    icon: '📦',
  },
];

const categoryMeta: { name: CategoryName; icon: string; color: string }[] = [
  { name: 'All', icon: '🛍️', color: '#E9F2FF' },
  { name: 'Milk', icon: '🥛', color: '#E7F6FF' },
  { name: 'Curd', icon: '🥣', color: '#E4F9E5' },
  { name: 'Ghee', icon: '🧈', color: '#FEEFE0' },
  { name: 'Paneer', icon: '🧀', color: '#FEE7D6' },
  { name: 'Sweets', icon: '🍮', color: '#FDE4F7' },
];

const products: Product[] = [
  {
    id: 1,
    name: 'Farm Fresh Cow Milk',
    category: 'Milk',
    price: 58,
    unit: '1 L',
    description: 'Pure milk collected daily from local dairy farms.',
    rating: 4.8,
    image: '🥛',
    tag: 'Best Seller',
  },
  {
    id: 2,
    name: 'Premium Toned Milk',
    category: 'Milk',
    price: 62,
    unit: '1 L',
    description: 'Low-fat, rich in nutrients and perfect for tea and coffee.',
    rating: 4.7,
    image: '🥛',
    tag: 'Low Fat',
  },
  {
    id: 3,
    name: 'Homemade Curd',
    category: 'Curd',
    price: 46,
    unit: '500 g',
    description: 'Smooth, creamy yogurt with a fresh homemade taste.',
    rating: 4.9,
    image: '🥣',
    tag: 'Fresh',
  },
  {
    id: 4,
    name: 'A2 Ghee',
    category: 'Ghee',
    price: 390,
    unit: '500 g',
    description: 'Pure clarified butter with rich aroma and taste.',
    rating: 4.9,
    image: '🧈',
    tag: 'Pure',
  },
  {
    id: 5,
    name: 'Soft Paneer',
    category: 'Paneer',
    price: 140,
    unit: '250 g',
    description: 'Fresh paneer made with hygienic, quality ingredients.',
    rating: 4.8,
    image: '🧀',
    tag: 'Fresh',
  },
  {
    id: 6,
    name: 'Kesar Peda',
    category: 'Sweets',
    price: 210,
    unit: '250 g',
    description: 'Traditional Indian sweet prepared with saffron and milk.',
    rating: 4.7,
    image: '🍮',
    tag: 'Popular',
  },
];

const defaultAddresses: Address[] = [
  { id: 1, label: 'Home', area: 'Indore', line: '12, Green Park Road, Vijay Nagar', isDefault: true },
  { id: 2, label: 'Office', area: 'Indore', line: '101, Business Avenue, Airport Road', },
  { id: 3, label: 'Other', area: 'Indore', line: 'Village Sukhdev Vihar, Near Bus Stand' },
];

const subscriptionSlots = ['Daily', 'Alternate Days', 'Mon–Sat', 'Sun Only'];
const deliveryTimings = ['6:00 AM', '8:00 AM', '10:00 AM', '6:30 PM'];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabName>('Home');
  const [selectedCategory, setSelectedCategory] = useState<CategoryName>('All');
  const [cart, setCart] = useState<CartItem[]>([
    { ...products[0], quantity: 2 },
    { ...products[4], quantity: 1 },
  ]);
  const [showPayment, setShowPayment] = useState(false);
  const [addresses, setAddresses] = useState<Address[]>(defaultAddresses);
  const [selectedAddressId, setSelectedAddressId] = useState<number>(1);
  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const [newAddressType, setNewAddressType] = useState<AddressType>('Home');
  const [newAddressText, setNewAddressText] = useState('');
  const [subscription, setSubscription] = useState('Daily');
  const [deliveryTime, setDeliveryTime] = useState('6:00 AM');
  const [userLocation, setUserLocation] = useState<string | null>(null);

  // Handle device back button on Android
  useEffect(() => {
    const backAction = () => {
      if (showPayment) {
        setShowPayment(false);
        return true;
      }
      if (activeTab !== 'Home') {
        setActiveTab('Home');
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [showPayment, activeTab]);

  // Get user's current location on app start
  useEffect(() => {
    const getLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.log('Location permission denied');
          return;
        }

        const location = await Location.getCurrentPositionAsync({});
        const reverseGeocode = await Location.reverseGeocodeAsync({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });

        if (reverseGeocode.length > 0) {
          const addr = reverseGeocode[0];
          const addressStr = `${addr.street || ''} ${addr.city || ''} ${addr.postalCode || ''}`.trim();
          setUserLocation(addressStr || 'Current Location');

          // Update default address with user's location
          setAddresses((current) =>
            current.map((a) =>
              a.isDefault
                ? { ...a, line: addressStr || 'Current Location', area: addr.city || 'India' }
                : a
            )
          );
        }
      } catch (error) {
        console.log('Location error:', error);
      }
    };

    getLocation();
  }, []);

  const visibleProducts = useMemo(() => {
    if (selectedCategory === 'All') return products;
    return products.filter((item) => item.category === selectedCategory);
  }, [selectedCategory]);

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryCharge = subtotal > 0 ? 29 : 0;
  const total = subtotal + deliveryCharge;
  const selectedAddress = addresses.find((item) => item.id === selectedAddressId) ?? addresses[0];

  const addToCart = (product: Product) => {
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (existing) {
        return current.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...current, { ...product, quantity: 1 }];
    });
    Alert.alert('Added to cart', `${product.name} has been added to your cart.`);
  };

  const updateCartQuantity = (productId: number, delta: number) => {
    setCart((current) =>
      current
        .map((item) =>
          item.id === productId ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const saveNewAddress = () => {
    if (!newAddressText.trim()) {
      Alert.alert('Missing address', 'Please enter a valid address.');
      return;
    }

    const nextAddress: Address = {
      id: Date.now(),
      label: newAddressType,
      area: 'Indore',
      line: newAddressText.trim(),
    };

    setAddresses((current) => [...current, nextAddress]);
    setSelectedAddressId(nextAddress.id);
    setNewAddressText('');
    setLocationModalVisible(false);
    Alert.alert('Address saved', `${newAddressType} address saved successfully.`);
  };

  const renderHeader = () => (
    <View style={styles.headerWrap}>
      <View style={styles.headerTop}>
        <View>
          <Text style={styles.headerLabel}>Deliver to</Text>
          <TouchableOpacity onPress={() => setLocationModalVisible(true)}>
            <Text style={styles.locationText}>
              {selectedAddress?.label ?? 'Home'} • {selectedAddress?.area ?? 'Indore'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconButton}>
            <Text style={styles.iconText}>⌕</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={() => setActiveTab('Cart')}>
            <Text style={styles.iconText}>🛒</Text>
            {cart.length > 0 && <View style={styles.cartBadge}><Text style={styles.cartBadgeText}>{cart.length}</Text></View>}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.brandRow}>
        <View>
          <Text style={styles.brandTitle}>Azad Dairy</Text>
          <Text style={styles.brandSubtitle}>Fresh & trusted every day</Text>
        </View>
        <View style={styles.promoBadge}><Text style={styles.promoBadgeText}>Free delivery</Text></View>
      </View>
    </View>
  );

  const renderHomeContent = () => (
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      {renderHeader()}

      <View style={styles.sliderSection}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sliderTrack}>
          {sliderData.map((slide) => (
            <View key={slide.id} style={[styles.slideCard, { backgroundColor: slide.color }]}>
              <Text style={styles.slideIcon}>{slide.icon}</Text>
              <Text style={styles.slideTitle}>{slide.title}</Text>
              <Text style={styles.slideSubtitle}>{slide.subtitle}</Text>
            </View>
          ))}
        </ScrollView>
      </View>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Categories</Text>
        <TouchableOpacity>
          <Text style={styles.linkText}>View all</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
        {categoryMeta.map((category) => {
          const isSelected = selectedCategory === category.name;
          return (
            <TouchableOpacity
              key={category.name}
              style={[styles.categoryPill, isSelected && styles.categoryPillSelected, { backgroundColor: category.color }]}
              onPress={() => setSelectedCategory(category.name)}
            >
              <Text style={styles.categoryIcon}>{category.icon}</Text>
              <Text style={[styles.categoryText, isSelected && styles.categoryTextSelected]}>{category.name}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.subscriptionCard}>
        <View style={styles.subscriptionHeaderRow}>
          <View>
            <Text style={styles.subscriptionLabel}>Milk subscription</Text>
            <Text style={styles.subscriptionTitle}>Choose your schedule</Text>
          </View>
          <View style={styles.subscriptionBadge}><Text style={styles.subscriptionBadgeText}>Save 12%</Text></View>
        </View>

        <View style={styles.optionGrid}>
          {subscriptionSlots.map((slot) => (
            <TouchableOpacity
              key={slot}
              style={[styles.optionButton, subscription === slot && styles.optionButtonSelected]}
              onPress={() => setSubscription(slot)}
            >
              <Text style={[styles.optionText, subscription === slot && styles.optionTextSelected]}>{slot}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.timeRow}>
          <Text style={styles.timeLabel}>Delivery time</Text>
          <View style={styles.timePicker}>
            {deliveryTimings.map((time) => (
              <TouchableOpacity
                key={time}
                style={[styles.timeChip, deliveryTime === time && styles.timeChipSelected]}
                onPress={() => setDeliveryTime(time)}
              >
                <Text style={[styles.timeChipText, deliveryTime === time && styles.timeChipTextSelected]}>{time}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>{selectedCategory === 'All' ? 'All products' : selectedCategory}</Text>
        <Text style={styles.resultCount}>{visibleProducts.length} items</Text>
      </View>

      <View style={styles.productGrid}>
        {visibleProducts.map((product) => (
          <View key={product.id} style={styles.productCard}>
            <View style={styles.productImageWrap}>
              <Text style={styles.productImage}>{product.image}</Text>
              <View style={styles.productBadge}><Text style={styles.productBadgeText}>{product.tag}</Text></View>
            </View>

            <Text style={styles.productName}>{product.name}</Text>
            <Text style={styles.productDescription}>{product.description}</Text>

            <View style={styles.productMetaRow}>
              <Text style={styles.productRating}>⭐ {product.rating}</Text>
              <Text style={styles.productUnit}>{product.unit}</Text>
            </View>

            <View style={styles.productFooterRow}>
              <Text style={styles.productPrice}>₹{product.price}</Text>
              <TouchableOpacity style={styles.addButton} onPress={() => addToCart(product)}>
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );

  const renderProductsContent = () => (
    <View style={styles.page}> 
      {renderHeader()}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Shop by category</Text>
        <Text style={styles.resultCount}>{products.length} products</Text>
      </View>

      <FlatList
        data={products}
        keyExtractor={(item) => `prod-${item.id}`}
        numColumns={2}
        columnWrapperStyle={styles.productColumnWrapper}
        contentContainerStyle={styles.productListContainer}
        renderItem={({ item }) => (
          <View style={styles.productCardWide}>
            <View style={styles.productImageWrap}>
              <Text style={styles.productImage}>{item.image}</Text>
              <View style={styles.productBadge}><Text style={styles.productBadgeText}>{item.tag}</Text></View>
            </View>
            <Text style={styles.productName}>{item.name}</Text>
            <Text style={styles.productMeta}>{item.category} • {item.unit}</Text>
            <View style={styles.productFooterRow}>
              <Text style={styles.productPrice}>₹{item.price}</Text>
              <TouchableOpacity style={styles.addButton} onPress={() => addToCart(item)}>
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );

  const renderCartContent = () => (
    <View style={styles.page}>
      {renderHeader()}

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Your cart</Text>
        <Text style={styles.resultCount}>{cart.length} items</Text>
      </View>

      {cart.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>🛒</Text>
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptyText}>Add fresh dairy products to continue.</Text>
        </View>
      ) : (
        <>
          {cart.map((item) => (
            <View key={item.id} style={styles.cartRow}>
              <View style={styles.cartItemLeft}>
                <View style={styles.cartItemIcon}><Text style={styles.productImage}>{item.image}</Text></View>
                <View style={styles.cartItemTextWrap}>
                  <Text style={styles.cartItemTitle}>{item.name}</Text>
                  <Text style={styles.cartItemMeta}>{item.unit}</Text>
                  <Text style={styles.cartItemPrice}>₹{item.price}</Text>
                </View>
              </View>

              <View style={styles.cartActions}>
                <TouchableOpacity style={styles.qtyButton} onPress={() => updateCartQuantity(item.id, -1)}>
                  <Text style={styles.qtyButtonText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.qtyValue}>{item.quantity}</Text>
                <TouchableOpacity style={styles.qtyButton} onPress={() => updateCartQuantity(item.id, 1)}>
                  <Text style={styles.qtyButtonText}>＋</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>₹{subtotal}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Delivery</Text>
              <Text style={styles.summaryValue}>₹{deliveryCharge}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabelStrong}>Total</Text>
              <Text style={styles.summaryValueStrong}>₹{total}</Text>
            </View>

            <TouchableOpacity style={styles.primaryButton} onPress={() => setShowPayment(true)}>
              <Text style={styles.primaryButtonText}>Proceed to payment</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );

  const renderProfileContent = () => (
    <View style={styles.page}>
      {renderHeader()}

      <View style={styles.profileHeaderCard}>
        <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>A</Text></View>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>Anand Sharma</Text>
          <Text style={styles.profilePhone}>+91 98765 43210</Text>
        </View>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.cardTitle}>Saved addresses</Text>
        {addresses.map((address) => (
          <Pressable
            key={address.id}
            style={[styles.addressRow, selectedAddressId === address.id && styles.addressRowSelected]}
            onPress={() => setSelectedAddressId(address.id)}
          >
            <View style={styles.addressLeft}>
              <Text style={styles.addressType}>{address.label}</Text>
              <Text style={styles.addressLine}>{address.line}</Text>
            </View>
            {address.isDefault && <Text style={styles.defaultTag}>Default</Text>}
          </Pressable>
        ))}

        <TouchableOpacity onPress={() => setLocationModalVisible(true)} style={styles.secondaryButtonSmall}>
          <Text style={styles.secondaryButtonText}>Add new address</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.cardTitle}>Subscription</Text>
        <Text style={styles.subscriptionInfo}>Plan: {subscription}</Text>
        <Text style={styles.subscriptionInfo}>Delivery time: {deliveryTime}</Text>
      </View>
    </View>
  );

  const renderPaymentScreen = () => (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7FA" />
      <View style={styles.paymentScreen}>
        <TouchableOpacity style={styles.backButton} onPress={() => setShowPayment(false)}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.paymentTitle}>Checkout</Text>
        <Text style={styles.paymentSubtitle}>Delivery to {selectedAddress?.label} • {selectedAddress?.line}</Text>

        <View style={styles.summaryCard}>
          <Text style={styles.cardTitle}>Order summary</Text>
          {cart.map((item) => (
            <View key={item.id} style={styles.paymentItemRow}>
              <Text style={styles.paymentItemText}>{item.name} x{item.quantity}</Text>
              <Text style={styles.paymentItemText}>₹{item.price * item.quantity}</Text>
            </View>
          ))}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal</Text>
            <Text style={styles.summaryValue}>₹{subtotal}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Delivery</Text>
            <Text style={styles.summaryValue}>₹{deliveryCharge}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabelStrong}>Total</Text>
            <Text style={styles.summaryValueStrong}>₹{total}</Text>
          </View>
        </View>

        <View style={styles.paymentNotice}>
          <Text style={styles.paymentNoticeTitle}>Payment gateway</Text>
          <Text style={styles.paymentNoticeText}>Integration will be added later. For now this is a frontend-only checkout flow.</Text>
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={() => Alert.alert('Order placed', 'Your order has been placed successfully.') }>
          <Text style={styles.primaryButtonText}>Place order</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  const renderMainContent = () => {
    if (showPayment) return renderPaymentScreen();

    switch (activeTab) {
      case 'Home':
        return renderHomeContent();
      case 'Products':
        return renderProductsContent();
      case 'Cart':
        return renderCartContent();
      case 'Profile':
        return renderProfileContent();
      default:
        return renderHomeContent();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7FA" />
      {renderMainContent()}

      {!showPayment && (
        <View style={styles.bottomTabbar}>
          {(['Home', 'Products', 'Cart', 'Profile'] as TabName[]).map((tab) => {
            const isSelected = activeTab === tab;
            const iconMap: Record<TabName, string> = {
              Home: '⌂',
              Products: '☰',
              Cart: '🛒',
              Profile: '👤',
            };
            return (
              <TouchableOpacity key={tab} style={styles.tabItem} onPress={() => setActiveTab(tab)}>
                <Text style={[styles.tabIcon, isSelected && styles.tabIconSelected]}>{iconMap[tab]}</Text>
                <Text style={[styles.tabText, isSelected && styles.tabTextSelected]}>{tab}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <Modal visible={locationModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>Select delivery location</Text>

            <View style={styles.addressTypeRow}>
              {(['Home', 'Office', 'Other'] as AddressType[]).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.addressTypeButton, newAddressType === type && styles.addressTypeButtonSelected]}
                  onPress={() => setNewAddressType(type)}
                >
                  <Text style={[styles.addressTypeText, newAddressType === type && styles.addressTypeTextSelected]}>{type}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              placeholder="Enter address like: 14, Ashok Vihar, Indore"
              value={newAddressText}
              onChangeText={setNewAddressText}
              multiline
              style={styles.addressInput}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setLocationModalVisible(false)}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButton} onPress={saveNewAddress}>
                <Text style={styles.primaryButtonText}>Save address</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
const isSmallScreen = screenWidth < 375;
