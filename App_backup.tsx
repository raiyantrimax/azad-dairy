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
const isMediumScreen = screenWidth >= 375 && screenWidth < 768;
const isLargeScreen = screenWidth >= 768;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  page: {
    flex: 1,
    paddingHorizontal: isSmallScreen ? 12 : 16,
    paddingBottom: 110,
  },
  headerWrap: {
    paddingTop: 12,
    marginBottom: 12,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLabel: {
    fontSize: isSmallScreen ? 11 : 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  locationText: {
    fontSize: isSmallScreen ? 13 : 15,
    fontWeight: '700',
    color: '#111827',
    maxWidth: '70%',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: isSmallScreen ? 36 : 42,
    height: isSmallScreen ? 36 : 42,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
  },
  iconText: {
    fontSize: isSmallScreen ? 16 : 20,
  },
  cartBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#E95B4D',
    borderRadius: 999,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  cartBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
  },
  brandTitle: {
    fontSize: isSmallScreen ? 24 : 28,
    fontWeight: '800',
    color: '#1F2937',
  },
  brandSubtitle: {
    fontSize: isSmallScreen ? 11 : 13,
    color: '#6B7280',
    marginTop: 4,
  },
  promoBadge: {
    backgroundColor: '#EAF8EE',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  promoBadgeText: {
    color: '#1F9D5A',
    fontWeight: '700',
    fontSize: isSmallScreen ? 10 : 12,
  },
  sliderSection: {
    marginBottom: 18,
  },
  sliderTrack: {
    paddingRight: 8,
  },
  slideCard: {
    width: screenWidth * 0.7,
    height: screenHeight * 0.15,
    borderRadius: 22,
    padding: 18,
    marginRight: 12,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 16,
    elevation: 4,
  },
  slideIcon: {
    fontSize: isSmallScreen ? 28 : 32,
  },
  slideTitle: {
    fontSize: isSmallScreen ? 16 : 20,
    fontWeight: '800',
    color: '#111827',
  },
  slideSubtitle: {
    fontSize: isSmallScreen ? 11 : 13,
    color: '#374151',
    marginTop: 4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: isSmallScreen ? 18 : 20,
    fontWeight: '800',
    color: '#111827',
  },
  linkText: {
    color: '#0B7B63',
    fontWeight: '700',
    fontSize: isSmallScreen ? 11 : 13,
  },
  resultCount: {
    color: '#6B7280',
    fontSize: isSmallScreen ? 11 : 12,
    fontWeight: '600',
  },
  categoryRow: {
    paddingBottom: 8,
  },
  categoryPill: {
    minWidth: isSmallScreen ? 80 : 92,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  categoryPillSelected: {
    borderColor: '#0B7B63',
    backgroundColor: '#E1FAF3',
  },
  categoryIcon: {
    fontSize: isSmallScreen ? 18 : 22,
    marginBottom: 4,
  },
  categoryText: {
    fontSize: isSmallScreen ? 10 : 12,
    fontWeight: '700',
    color: '#374151',
  },
  categoryTextSelected: {
    color: '#0B7B63',
  },
  subscriptionCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: isSmallScreen ? 12 : 16,
    marginVertical: 18,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14,
    elevation: 2,
  },
  subscriptionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  subscriptionLabel: {
    color: '#10B981',
    fontWeight: '700',
    fontSize: isSmallScreen ? 10 : 12,
    textTransform: 'uppercase',
  },
  subscriptionTitle: {
    fontSize: isSmallScreen ? 16 : 18,
    fontWeight: '800',
    color: '#111827',
    marginTop: 6,
  },
  subscriptionBadge: {
    backgroundColor: '#ECFDF5',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  subscriptionBadgeText: {
    color: '#047857',
    fontWeight: '700',
    fontSize: isSmallScreen ? 9 : 11,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 14,
    gap: 8,
  },
  optionButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    marginRight: 8,
    marginBottom: 8,
  },
  optionButtonSelected: {
    backgroundColor: '#0B7B63',
  },
  optionText: {
    fontSize: isSmallScreen ? 11 : 12,
    textAlign: 'center',
    color: '#374151',
    fontWeight: '700',
  },
  optionTextSelected: {
    color: '#fff',
  },
  timeRow: {
    marginTop: 14,
  },
  timeLabel: {
    fontSize: isSmallScreen ? 12 : 13,
    color: '#374151',
    fontWeight: '700',
    marginBottom: 8,
  },
  timePicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timeChip: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    marginRight: 8,
    marginBottom: 8,
  },
  timeChipSelected: {
    backgroundColor: '#E0F2FE',
  },
  timeChipText: {
    color: '#374151',
    fontWeight: '700',
    fontSize: isSmallScreen ? 10 : 11,
  },
  timeChipTextSelected: {
    color: '#0369A1',
  },
  productGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingBottom: 15,
  },
  productCard: {
    width: isSmallScreen ? '48%' : isLargeScreen ? '31%' : '48%',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: isSmallScreen ? 10 : 12,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 16,
    elevation: 2,
  },
  productCardWide: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: isSmallScreen ? 10 : 12,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 14,
    elevation: 2,
  },
  productImageWrap: {
    backgroundColor: '#F3F4F6',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    height: isSmallScreen ? 90 : 110,
    position: 'relative',
  },
  productImage: {
    fontSize: isSmallScreen ? 32 : 38,
  },
  productBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#EAF8EE',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  productBadgeText: {
    color: '#1D7A53',
    fontSize: isSmallScreen ? 8 : 10,
    fontWeight: '800',
  },
  productName: {
    fontSize: isSmallScreen ? 13 : 15,
    fontWeight: '800',
    color: '#111827',
    marginTop: 10,
  },
  productDescription: {
    fontSize: isSmallScreen ? 10 : 11,
    color: '#6B7280',
    lineHeight: 16,
    marginTop: 6,
  },
  productMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  productRating: {
    fontSize: isSmallScreen ? 11 : 12,
    color: '#F59E0B',
    fontWeight: '700',
  },
  productUnit: {
    fontSize: isSmallScreen ? 10 : 11,
    color: '#374151',
    fontWeight: '700',
  },
  productMeta: {
    fontSize: isSmallScreen ? 10 : 11,
    color: '#6B7280',
    marginTop: 6,
  },
  productFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  productPrice: {
    fontSize: isSmallScreen ? 16 : 20,
    fontWeight: '800',
    color: '#111827',
  },
  addButton: {
    backgroundColor: '#0B7B63',
    paddingHorizontal: isSmallScreen ? 12 : 16,
    paddingVertical: isSmallScreen ? 8 : 10,
    borderRadius: 12,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: isSmallScreen ? 11 : 12,
  },
  productListContainer: {
    paddingBottom: 18,
  },
  productColumnWrapper: {
    justifyContent: 'space-between',
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  emptyIcon: {
    fontSize: isSmallScreen ? 28 : 34,
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: isSmallScreen ? 16 : 18,
    fontWeight: '800',
    color: '#111827',
  },
  emptyText: {
    marginTop: 6,
    color: '#6B7280',
    textAlign: 'center',
    fontSize: isSmallScreen ? 12 : 14,
  },
  cartRow: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: isSmallScreen ? 10 : 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cartItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  cartItemIcon: {
    width: isSmallScreen ? 48 : 56,
    height: isSmallScreen ? 48 : 56,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartItemTextWrap: {
    marginLeft: 10,
    flex: 1,
  },
  cartItemTitle: {
    fontSize: isSmallScreen ? 13 : 15,
    fontWeight: '800',
    color: '#111827',
  },
  cartItemMeta: {
    fontSize: isSmallScreen ? 10 : 11,
    color: '#6B7280',
    marginTop: 4,
  },
  cartItemPrice: {
    fontSize: isSmallScreen ? 13 : 15,
    fontWeight: '800',
    color: '#111827',
    marginTop: 4,
  },
  cartActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 10,
  },
  qtyButton: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyButtonText: {
    fontSize: isSmallScreen ? 16 : 18,
    color: '#111827',
    fontWeight: '700',
  },
  qtyValue: {
    width: 24,
    textAlign: 'center',
    fontSize: isSmallScreen ? 12 : 14,
    fontWeight: '700',
    color: '#111827',
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginTop: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  summaryLabel: {
    color: '#6B7280',
    fontWeight: '600',
    fontSize: isSmallScreen ? 12 : 14,
  },
  summaryValue: {
    color: '#111827',
    fontWeight: '700',
    fontSize: isSmallScreen ? 12 : 14,
  },
  summaryLabelStrong: {
    color: '#111827',
    fontWeight: '800',
    fontSize: isSmallScreen ? 14 : 15,
  },
  summaryValueStrong: {
    color: '#111827',
    fontWeight: '800',
    fontSize: isSmallScreen ? 14 : 15,
  },
  primaryButton: {
    backgroundColor: '#0B7B63',
    borderRadius: 14,
    paddingVertical: isSmallScreen ? 12 : 14,
    alignItems: 'center',
    marginTop: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: isSmallScreen ? 13 : 15,
  },
  secondaryButton: {
    backgroundColor: '#EEF2F7',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  secondaryButtonSmall: {
    backgroundColor: '#EEF2F7',
    borderRadius: 12,
    marginTop: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: isSmallScreen ? 12 : 14,
  },
  profileHeaderCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  profileAvatar: {
    width: isSmallScreen ? 50 : 60,
    height: isSmallScreen ? 50 : 60,
    borderRadius: 18,
    backgroundColor: '#0B7B63',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: isSmallScreen ? 20 : 24,
  },
  profileInfo: {
    marginLeft: 14,
  },
  profileName: {
    fontSize: isSmallScreen ? 16 : 18,
    fontWeight: '800',
    color: '#111827',
  },
  profilePhone: {
    fontSize: isSmallScreen ? 11 : 13,
    color: '#6B7280',
    marginTop: 4,
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: isSmallScreen ? 15 : 17,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  addressRowSelected: {
    borderColor: '#0B7B63',
    backgroundColor: '#F1FBF7',
  },
  addressLeft: {
    flex: 1,
  },
  addressType: {
    fontSize: isSmallScreen ? 12 : 13,
    fontWeight: '800',
    color: '#111827',
  },
  addressLine: {
    color: '#6B7280',
    fontSize: isSmallScreen ? 11 : 12,
    marginTop: 4,
  },
  defaultTag: {
    backgroundColor: '#ECFDF5',
    color: '#047857',
    fontWeight: '700',
    fontSize: isSmallScreen ? 9 : 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  subscriptionInfo: {
    color: '#374151',
    fontSize: isSmallScreen ? 12 : 14,
    marginBottom: 6,
  },
  bottomTabbar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: isMediumScreen ? 10 : 12,
    paddingHorizontal: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 6,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  tabIcon: {
    fontSize: isSmallScreen ? 18 : 20,
    color: '#6B7280',
  },
  tabIconSelected: {
    color: '#0B7B63',
  },
  tabText: {
    marginTop: 4,
    fontSize: isSmallScreen ? 9 : 11,
    color: '#6B7280',
    fontWeight: '700',
  },
  tabTextSelected: {
    color: '#0B7B63',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  addressTypeRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  addressTypeButton: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    paddingVertical: 10,
    marginRight: 8,
    alignItems: 'center',
  },
  addressTypeButtonSelected: {
    backgroundColor: '#E1FAF3',
  },
  addressTypeText: {
    fontWeight: '700',
    color: '#374151',
    fontSize: isSmallScreen ? 12 : 14,
  },
  addressTypeTextSelected: {
    color: '#0B7B63',
  },
  addressInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 14,
    fontSize: isSmallScreen ? 12 : 14,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  paymentScreen: {
    flex: 1,
    paddingHorizontal: isSmallScreen ? 12 : 16,
    paddingTop: 16,
    backgroundColor: '#F5F7FA',
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  backButtonText: {
    fontSize: isSmallScreen ? 14 : 16,
    fontWeight: '700',
    color: '#111827',
  },
  paymentTitle: {
    fontSize: isSmallScreen ? 24 : 30,
    fontWeight: '800',
    color: '#111827',
  },
  paymentSubtitle: {
    color: '#6B7280',
    marginTop: 6,
    marginBottom: 18,
    fontSize: isSmallScreen ? 12 : 14,
  },
  paymentItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  paymentItemText: {
    color: '#374151',
    fontSize: isSmallScreen ? 12 : 13,
    fontWeight: '600',
  },
  paymentNotice: {
    backgroundColor: '#FDF5D8',
    borderRadius: 16,
    padding: 16,
    marginTop: 18,
    borderWidth: 1,
    borderColor: '#F2D57A',
  },
  paymentNoticeTitle: {
    color: '#8A6800',
    fontWeight: '800',
    fontSize: isSmallScreen ? 12 : 14,
    marginBottom: 4,
  },
  paymentNoticeText: {
    color: '#6B7280',
    fontSize: isSmallScreen ? 12 : 13,
    lineHeight: 20,
  },
});
    marginBottom: 4,
  },
  locationText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    position: 'relative',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
  },
  iconText: {
    fontSize: 20,
  },
  cartBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#E95B4D',
    borderRadius: 999,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  cartBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
  },
  brandTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1F2937',
  },
  brandSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
  },
  promoBadge: {
    backgroundColor: '#EAF8EE',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  promoBadgeText: {
    color: '#1F9D5A',
    fontWeight: '700',
    fontSize: 12,
  },
  sliderSection: {
    marginBottom: 18,
  },
  sliderTrack: {
    paddingRight: 8,
  },
  slideCard: {
    width: 250,
    height: 150,
    borderRadius: 22,
    padding: 18,
    marginRight: 12,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 16,
    elevation: 4,
  },
  slideIcon: {
    fontSize: 32,
  },
  slideTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  slideSubtitle: {
    fontSize: 13,
    color: '#374151',
    marginTop: 4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  linkText: {
    color: '#0B7B63',
    fontWeight: '700',
    fontSize: 13,
  },
  resultCount: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
  categoryRow: {
    paddingBottom: 8,
  },
  categoryPill: {
    minWidth: 92,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  categoryPillSelected: {
    borderColor: '#0B7B63',
    backgroundColor: '#E1FAF3',
  },
  categoryIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  categoryTextSelected: {
    color: '#0B7B63',
  },
  subscriptionCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginVertical: 18,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14,
    elevation: 2,
  },
  subscriptionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  subscriptionLabel: {
    color: '#10B981',
    fontWeight: '700',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  subscriptionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    marginTop: 6,
  },
  subscriptionBadge: {
    backgroundColor: '#ECFDF5',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  subscriptionBadgeText: {
    color: '#047857',
    fontWeight: '700',
    fontSize: 11,
  },
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 14,
    gap: 8,
  },
  optionButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    marginRight: 8,
    marginBottom: 8,
  },
  optionButtonSelected: {
    backgroundColor: '#0B7B63',
  },
  optionText: {
    fontSize: 12,
    textAlign: 'center',
    color: '#374151',
    fontWeight: '700',
  },
  optionTextSelected: {
    color: '#fff',
  },
  timeRow: {
    marginTop: 14,
  },
  timeLabel: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '700',
    marginBottom: 8,
  },
  timePicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timeChip: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    marginRight: 8,
    marginBottom: 8,
  },
  timeChipSelected: {
    backgroundColor: '#E0F2FE',
  },
  timeChipText: {
    color: '#374151',
    fontWeight: '700',
    fontSize: 11,
  },
  timeChipTextSelected: {
    color: '#0369A1',
  },
  productGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingBottom: 15,
  },
  productCard: {
    width: '48.5%',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 12,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 16,
    elevation: 2,
  },
  productCardWide: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 12,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 14,
    elevation: 2,
  },
  productImageWrap: {
    backgroundColor: '#F3F4F6',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    height: 110,
    position: 'relative',
  },
  productImage: {
    fontSize: 38,
  },
  productBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#EAF8EE',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  productBadgeText: {
    color: '#1D7A53',
    fontSize: 10,
    fontWeight: '800',
  },
  productName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    marginTop: 12,
  },
  productDescription: {
    fontSize: 11,
    color: '#6B7280',
    lineHeight: 16,
    marginTop: 6,
  },
  productMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  productRating: {
    fontSize: 12,
    color: '#F59E0B',
    fontWeight: '700',
  },
  productUnit: {
    fontSize: 11,
    color: '#374151',
    fontWeight: '700',
  },
  productMeta: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 6,
  },
  productFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  productPrice: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  addButton: {
    backgroundColor: '#0B7B63',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
  },
  productListContainer: {
    paddingBottom: 18,
  },
  productColumnWrapper: {
    justifyContent: 'space-between',
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  emptyIcon: {
    fontSize: 34,
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  emptyText: {
    marginTop: 6,
    color: '#6B7280',
    textAlign: 'center',
  },
  cartRow: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cartItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  cartItemIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartItemTextWrap: {
    marginLeft: 12,
    flex: 1,
  },
  cartItemTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
  },
  cartItemMeta: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 4,
  },
  cartItemPrice: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    marginTop: 4,
  },
  cartActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  qtyButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qtyButtonText: {
    fontSize: 18,
    color: '#111827',
    fontWeight: '700',
  },
  qtyValue: {
    width: 28,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  summaryCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginTop: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  summaryLabel: {
    color: '#6B7280',
    fontWeight: '600',
    fontSize: 14,
  },
  summaryValue: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 14,
  },
  summaryLabelStrong: {
    color: '#111827',
    fontWeight: '800',
    fontSize: 15,
  },
  summaryValueStrong: {
    color: '#111827',
    fontWeight: '800',
    fontSize: 15,
  },
  primaryButton: {
    backgroundColor: '#0B7B63',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 15,
  },
  secondaryButton: {
    backgroundColor: '#EEF2F7',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  secondaryButtonSmall: {
    backgroundColor: '#EEF2F7',
    borderRadius: 12,
    marginTop: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#111827',
    fontWeight: '700',
    fontSize: 14,
  },
  profileHeaderCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  profileAvatar: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: '#0B7B63',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 24,
  },
  profileInfo: {
    marginLeft: 14,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  profilePhone: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 12,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  addressRowSelected: {
    borderColor: '#0B7B63',
    backgroundColor: '#F1FBF7',
  },
  addressLeft: {
    flex: 1,
  },
  addressType: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
  },
  addressLine: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 4,
  },
  defaultTag: {
    backgroundColor: '#ECFDF5',
    color: '#047857',
    fontWeight: '700',
    fontSize: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  subscriptionInfo: {
    color: '#374151',
    fontSize: 14,
    marginBottom: 6,
  },
  bottomTabbar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 6,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  tabIcon: {
    fontSize: 20,
    color: '#6B7280',
  },
  tabIconSelected: {
    color: '#0B7B63',
  },
  tabText: {
    marginTop: 4,
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '700',
  },
  tabTextSelected: {
    color: '#0B7B63',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  addressTypeRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  addressTypeButton: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    paddingVertical: 10,
    marginRight: 8,
    alignItems: 'center',
  },
  addressTypeButtonSelected: {
    backgroundColor: '#E1FAF3',
  },
  addressTypeText: {
    fontWeight: '700',
    color: '#374151',
  },
  addressTypeTextSelected: {
    color: '#0B7B63',
  },
  addressInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 14,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  paymentScreen: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    backgroundColor: '#F5F7FA',
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  paymentTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: '#111827',
  },
  paymentSubtitle: {
    color: '#6B7280',
    marginTop: 6,
    marginBottom: 18,
    fontSize: 14,
  },
  paymentItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  paymentItemText: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '600',
  },
  paymentNotice: {
    backgroundColor: '#FDF5D8',
    borderRadius: 16,
    padding: 16,
    marginTop: 18,
    borderWidth: 1,
    borderColor: '#F2D57A',
  },
  paymentNoticeTitle: {
    color: '#8A6800',
    fontWeight: '800',
    fontSize: 14,
    marginBottom: 4,
  },
  paymentNoticeText: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 20,
  },
});
