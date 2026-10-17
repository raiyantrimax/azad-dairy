import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Alert,
  Image,
  Linking,
  BackHandler,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Pressable,
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
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import {
  ApiAddress,
  ApiOrder,
  ApiProduct,
  ApiSubscription,
  ApiUser,
  apiEnabled,
  apiRequest,
  getAuthToken,
  removeAuthToken,
  resolveApiUrl,
  saveAuthToken,
} from './src/api';

// react-native-maps is native-only in this app; avoid loading its native code on web.
const mapsModule = Platform.OS === 'web'
  ? null
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  : require('react-native-maps') as typeof import('react-native-maps');
const MapView = mapsModule?.default!;
const Marker = mapsModule?.Marker!;
const PROVIDER_GOOGLE = mapsModule?.PROVIDER_GOOGLE;

type TabName = 'Home' | 'Cart' | 'Profile';
type CategoryName = string;
type AddressType = 'Home' | 'Office' | 'Other';
type AuthMode = 'register' | 'login';

type Product = {
  id: string | number;
  name: string;
  category: string;
  price: number;
  originalPrice?: number;
  mrp?: number;
  stock?: number;
  unit: string;
  description: string;
  rating: number;
  image: string;
  images?: string[];
  tags?: string[];
  subscriptionAllowed?: boolean;
  discountAmount?: number;
  tag: string;
};

type CartItem = Product & {
  quantity: number;
};

type ProductSubscriptionPlan = 'Daily' | 'Weekly' | 'Alternate' | 'Monthly';

type ProductSubscription = {
  product: Product;
  plan: ProductSubscriptionPlan;
  quantity: number;
  days: string[];
  startDate: Date;
  endDate: Date | null;
};

type Address = {
  id: string | number;
  label: AddressType;
  area: string;
  line: string;
  houseDetails?: string;
  landmark?: string;
  latitude?: number;
  longitude?: number;
  isDefault?: boolean;
};

const mapApiProduct = (product: ApiProduct): Product => ({
  ...product,
  tag: product.discountAmount > 0 ? 'Offer' : product.tags?.[0] || '',
});

const mapApiAddress = (address: ApiAddress): Address => ({
  id: address.id,
  label: address.label,
  area: address.city,
  line: [address.line2, address.state, address.postalCode].filter(Boolean).join(', '),
  houseDetails: address.line1,
  landmark: address.landmark || undefined,
  latitude: address.latitude,
  longitude: address.longitude,
  isDefault: address.isDefault,
});

type Coordinates = {
  latitude: number;
  longitude: number;
};

type MapRegion = Coordinates & {
  latitudeDelta: number;
  longitudeDelta: number;
};

type PlaceSearchResult = {
  placeId: string;
  provider: 'google' | 'osm';
  mainText: string;
  secondaryText: string;
  description: string;
  coordinates: Coordinates;
};

type PhotonSearchResponse = {
  features?: {
    geometry?: { coordinates?: number[] };
    properties?: {
      osm_id?: number;
      osm_type?: string;
      name?: string;
      housenumber?: string;
      street?: string;
      district?: string;
      city?: string;
      state?: string;
      country?: string;
    };
  }[];
};

type GooglePlacesAutocompleteResponse = {
  suggestions?: {
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }[];
};

type GooglePlaceDetailsResponse = {
  location?: Coordinates;
  formattedAddress?: string;
  displayName?: { text?: string };
};

const googleMapsEnabled = process.env.EXPO_PUBLIC_USE_GOOGLE_MAPS === 'true';
const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? '';

const defaultMapRegion: MapRegion = {
  latitude: 22.7196,
  longitude: 75.8577,
  latitudeDelta: 0.012,
  longitudeDelta: 0.012,
};

const createOpenStreetMapHtml = (region: MapRegion, pin: Coordinates | null) => {
  const initialCenter = JSON.stringify([pin?.latitude ?? region.latitude, pin?.longitude ?? region.longitude]);
  const initialPin = pin ? JSON.stringify([pin.latitude, pin.longitude]) : 'null';

  return `<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <style>html, body, #map { height: 100%; margin: 0; } .leaflet-control-attribution { font-size: 10px; }</style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const center = ${initialCenter};
    const initialPin = ${initialPin};
    const map = L.map('map').setView(center, 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
    }).addTo(map);
    let marker = null;
    function sendCoordinates(point) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ latitude: point.lat, longitude: point.lng }));
    }
    function setMarker(point, notify) {
      if (marker) marker.setLatLng(point);
      else {
        marker = L.marker(point, { draggable: true }).addTo(map);
        marker.on('dragend', function(event) { sendCoordinates(event.target.getLatLng()); });
      }
      if (notify) sendCoordinates(point);
    }
    if (initialPin) setMarker(L.latLng(initialPin[0], initialPin[1]), false);
    map.on('click', function(event) { setMarker(event.latlng, true); });
  </script>
</body>
</html>`;
};

const formatAddress = (address: Address) =>
  [
    address.houseDetails,
    address.line,
    address.landmark ? `Near ${address.landmark}` : undefined,
  ].filter(Boolean).join(', ');

const searchOpenStreetMap = async (
  query: string,
  region: Coordinates,
  signal: AbortSignal
): Promise<PlaceSearchResult[]> => {
  const params = new URLSearchParams({
    q: query,
    limit: '5',
    lang: 'en',
    lat: String(region.latitude),
    lon: String(region.longitude),
  });
  const response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('OpenStreetMap place search is temporarily unavailable.');

  const result = await response.json() as PhotonSearchResponse;
  return (result.features ?? []).flatMap((feature): PlaceSearchResult[] => {
    const coordinates = feature.geometry?.coordinates;
    const properties = feature.properties;
    if (!coordinates || coordinates.length < 2 || !properties) return [];

    const [longitude, latitude] = coordinates;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    const detailParts = [properties.housenumber, properties.street, properties.district, properties.city, properties.state, properties.country]
      .filter((part): part is string => Boolean(part));
    const mainText = properties.name || properties.street || properties.city || properties.country || 'Selected place';
    const secondaryText = [...new Set(detailParts.filter((part) => part !== mainText))].join(', ');

    return [{
      placeId: `${properties.osm_type ?? 'osm'}-${properties.osm_id ?? coordinates.join('-')}`,
      provider: 'osm',
      mainText,
      secondaryText,
      description: [mainText, secondaryText].filter(Boolean).join(', '),
      coordinates: { latitude, longitude },
    }];
  });
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

const subscriptionPlans: ProductSubscriptionPlan[] = ['Daily', 'Weekly', 'Alternate', 'Monthly'];
const weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const formatSubscriptionDate = (date: Date) => date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const isSameCalendarDay = (first: Date, second: Date) =>
  first.getFullYear() === second.getFullYear()
  && first.getMonth() === second.getMonth()
  && first.getDate() === second.getDate();

export default function App() {
  const [activeTab, setActiveTab] = useState<TabName>('Home');
  const [selectedCategory, setSelectedCategory] = useState<CategoryName>('All');
  const [storeProducts, setStoreProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [subscriptionProduct, setSubscriptionProduct] = useState<Product | null>(null);
  const [subscriptionProductChoices, setSubscriptionProductChoices] = useState<Product[]>([]);
  const [productSubscriptionPlan, setProductSubscriptionPlan] = useState<ProductSubscriptionPlan>('Daily');
  const [productSubscriptionQuantity, setProductSubscriptionQuantity] = useState(1);
  const [productSubscriptionDays, setProductSubscriptionDays] = useState<string[]>(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
  const [productSubscriptionStartDate, setProductSubscriptionStartDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  });
  const [productSubscriptionEndDate, setProductSubscriptionEndDate] = useState<Date | null>(null);
  const [subscriptionCalendarMonth, setSubscriptionCalendarMonth] = useState(
    () => new Date(productSubscriptionStartDate.getFullYear(), productSubscriptionStartDate.getMonth(), 1)
  );
  const [isEditingSubscriptionDate, setIsEditingSubscriptionDate] = useState(false);
  const [activeProductSubscriptions, setActiveProductSubscriptions] = useState<ProductSubscription[]>([]);
  const [serverSubscriptions, setServerSubscriptions] = useState<ApiSubscription[]>([]);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<ApiUser | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>('register');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{ code: string; savings: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([
    { ...products[0], quantity: 2 },
    { ...products[4], quantity: 1 },
  ]);
  const [showPayment, setShowPayment] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [checkoutSubscription, setCheckoutSubscription] = useState<ProductSubscription | null>(null);
  const [addresses, setAddresses] = useState<Address[]>(defaultAddresses);
  const [selectedAddressId, setSelectedAddressId] = useState<string | number>(1);
  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | number | null>(null);
  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [googleMapReady, setGoogleMapReady] = useState(false);
  const [googleMapFailed, setGoogleMapFailed] = useState(false);
  const [newAddressType, setNewAddressType] = useState<AddressType>('Home');
  const [newHouseDetails, setNewHouseDetails] = useState('');
  const [newLandmark, setNewLandmark] = useState('');
  const [placeSearch, setPlaceSearch] = useState('');
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSearchResult[]>([]);
  const [isSearchingPlaces, setIsSearchingPlaces] = useState(false);
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  const [placesError, setPlacesError] = useState<string | null>(null);
  const [selectedCoordinates, setSelectedCoordinates] = useState<Coordinates | null>(null);
  const [selectedPlaceLabel, setSelectedPlaceLabel] = useState('');
  const [mapRegion, setMapRegion] = useState<MapRegion>(defaultMapRegion);
  const [userLocation, setUserLocation] = useState<string | null>(null);
  const [userCoordinates, setUserCoordinates] = useState<Coordinates | null>(null);
  const addressScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!apiEnabled) return;
    let cancelled = false;

    const restoreSession = async () => {
      setCart([]);
      try {
        const { products: remoteProducts } = await apiRequest<{ products: ApiProduct[] }>('/api/products');
        if (!cancelled) setStoreProducts(remoteProducts.map(mapApiProduct));
      } catch (error) {
        if (!cancelled) setServiceError(error instanceof Error ? error.message : 'Store catalog could not be loaded.');
      }

      const token = await getAuthToken();
      if (!token || cancelled) return;
      let user: ApiUser;
      try {
        ({ user } = await apiRequest<{ user: ApiUser }>('/api/auth/me', {}, token));
      } catch {
        await removeAuthToken();
        if (!cancelled) {
          setAuthToken(null);
          setCurrentUser(null);
          setServerSubscriptions([]);
          setAddresses([]);
          setSelectedAddressId('');
        }
        return;
      }
      if (cancelled) return;
      setAuthToken(token);
      setCurrentUser(user);
      setAddresses(user.addresses.map(mapApiAddress));
      setSelectedAddressId(user.addresses.find((address) => address.isDefault)?.id ?? user.addresses[0]?.id ?? '');
      try {
        const { subscriptions } = await apiRequest<{ subscriptions: ApiSubscription[] }>('/api/me/subscriptions', {}, token);
        if (!cancelled) setServerSubscriptions(subscriptions);
      } catch (error) {
        if (!cancelled) setServiceError(error instanceof Error ? error.message : 'Subscriptions could not be loaded.');
      }
    };

    void restoreSession();
    return () => { cancelled = true; };
  }, []);

  const submitAuth = async () => {
    setAuthError(null);
    setIsAuthSubmitting(true);
    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const result = await apiRequest<{ token: string; user: ApiUser }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          name: authName.trim(),
          email: authEmail.trim().toLowerCase(),
          phone: authPhone.trim(),
          password: authPassword,
        }),
      });
      await saveAuthToken(result.token);
      setAuthToken(result.token);
      setCurrentUser(result.user);
      setAddresses(result.user.addresses.map(mapApiAddress));
      setSelectedAddressId(result.user.addresses.find((address) => address.isDefault)?.id ?? result.user.addresses[0]?.id ?? '');
      setAuthPassword('');
      const { subscriptions } = await apiRequest<{ subscriptions: ApiSubscription[] }>('/api/me/subscriptions', {}, result.token);
      setServerSubscriptions(subscriptions);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const signOut = async () => {
    await removeAuthToken();
    setAuthToken(null);
    setCurrentUser(null);
    setServerSubscriptions([]);
    setAddresses(apiEnabled ? [] : defaultAddresses);
    setSelectedAddressId(apiEnabled ? '' : defaultAddresses[0].id);
    setCheckoutSubscription(null);
    setAppliedCoupon(null);
  };

  const applyCoupon = async () => {
    if (!authToken) {
      setCouponError('Sign in to apply a coupon.');
      return;
    }
    setCouponError(null);
    try {
      const result = await apiRequest<{ coupon: { code: string }; savings: number }>('/api/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({
          code: couponCode,
          amount: subtotal,
          productIds: cart.map((item) => String(item.id)),
        }),
      }, authToken);
      setAppliedCoupon({ code: result.coupon.code, savings: result.savings });
    } catch (error) {
      setAppliedCoupon(null);
      setCouponError(error instanceof Error ? error.message : 'Coupon could not be applied.');
    }
  };

  const scrollAddressFormIntoView = () => {
    setTimeout(() => addressScrollRef.current?.scrollToEnd({ animated: true }), 120);
  };

  useEffect(() => {
    if (!locationModalVisible || !googleMapsEnabled || !googleMapsApiKey || googleMapReady || googleMapFailed) return;

    const timeout = setTimeout(() => setGoogleMapFailed(true), 8000);
    return () => clearTimeout(timeout);
  }, [locationModalVisible, isMapExpanded, googleMapReady, googleMapFailed]);

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
        setUserCoordinates(location.coords);
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

  useEffect(() => {
    const query = placeSearch.trim();
    if (!locationModalVisible || query.length < (googleMapsEnabled ? 3 : 2)) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const fetchSuggestions = async () => {
        setIsSearchingPlaces(true);
        setPlacesError(
          googleMapsEnabled && !googleMapsApiKey
            ? 'Google Maps key is missing. Showing OpenStreetMap results instead.'
            : null
        );
        try {
          let suggestions: PlaceSearchResult[];
          if (googleMapsEnabled && googleMapsApiKey) {
            const bias = selectedCoordinates ?? userCoordinates ?? mapRegion;
            const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
              method: 'POST',
              signal: controller.signal,
              headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': googleMapsApiKey,
                'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text',
              },
              body: JSON.stringify({
                input: query,
                includedRegionCodes: ['in'],
                locationBias: {
                  circle: {
                    center: { latitude: bias.latitude, longitude: bias.longitude },
                    radius: 30000,
                  },
                },
              }),
            });
            const result = await response.json() as GooglePlacesAutocompleteResponse & {
              error?: { message?: string; status?: string };
            };
            if (!response.ok) {
              throw new Error(result.error?.message || `Google Places returned HTTP ${response.status}. Check billing, Places API (New), and key restrictions.`);
            }
            suggestions = (result.suggestions ?? []).flatMap(({ placePrediction }): PlaceSearchResult[] => {
              if (!placePrediction?.placeId) return [];
              return [{
                placeId: placePrediction.placeId,
                provider: 'google',
                mainText: placePrediction.structuredFormat?.mainText?.text ?? placePrediction.text?.text ?? '',
                secondaryText: placePrediction.structuredFormat?.secondaryText?.text ?? '',
                description: placePrediction.text?.text ?? '',
                coordinates: { latitude: 0, longitude: 0 },
              }];
            });
          } else {
            suggestions = await searchOpenStreetMap(query, mapRegion, controller.signal);
          }

          if (!controller.signal.aborted) {
            setPlaceSuggestions(suggestions);
            if (suggestions.length === 0) setPlacesError('No matching places found. Try a nearby area or landmark.');
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            const googleError = error instanceof Error ? error.message : 'Google Places search failed.';
            if (googleMapsEnabled && googleMapsApiKey) {
              try {
                const fallbackSuggestions = await searchOpenStreetMap(query, mapRegion, controller.signal);
                if (controller.signal.aborted) return;
                setPlaceSuggestions(fallbackSuggestions);
                setPlacesError(
                  fallbackSuggestions.length > 0
                    ? `Google Places: ${googleError} Showing OpenStreetMap results instead.`
                    : `Google Places: ${googleError} No OpenStreetMap matches found.`
                );
              } catch (fallbackError) {
                if (controller.signal.aborted) return;
                const fallbackMessage = fallbackError instanceof Error
                  ? fallbackError.message
                  : 'OpenStreetMap search failed.';
                setPlacesError(`Google Places: ${googleError} ${fallbackMessage}`);
                setPlaceSuggestions([]);
              }
            } else {
              setPlacesError(error instanceof Error ? error.message : 'Could not search for places.');
              setPlaceSuggestions([]);
            }
          }
        } finally {
          if (!controller.signal.aborted) setIsSearchingPlaces(false);
        }
      };

      void fetchSuggestions();
    }, googleMapsEnabled ? 550 : 450);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    locationModalVisible,
    mapRegion,
    mapRegion.latitude,
    mapRegion.longitude,
    placeSearch,
    selectedCoordinates,
    selectedCoordinates?.latitude,
    selectedCoordinates?.longitude,
    userCoordinates,
    userCoordinates?.latitude,
    userCoordinates?.longitude,
  ]);

  const visibleProducts = useMemo(() => {
    const catalog = storeProducts.length ? storeProducts : products;
    if (selectedCategory === 'All') return catalog;
    return catalog.filter((item) => item.category === selectedCategory);
  }, [selectedCategory, storeProducts]);
  const additionalCategoryNames = [...new Set(storeProducts.map((product) => product.category))]
    .filter((name) => !categoryMeta.some((category) => category.name === name));
  const visibleCategories = [
    ...categoryMeta,
    ...additionalCategoryNames.map((name) => ({ name, icon: '🧺', color: '#E8F4EE' })),
  ];

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const productDiscountTotal = cart.reduce((sum, item) => sum + Math.max(0, (item.originalPrice ?? item.price) - item.price) * item.quantity, 0);
  const deliveryCharge = subtotal > 0 ? 29 : 0;
  const total = Math.max(0, Math.round((subtotal + deliveryCharge - (appliedCoupon?.savings ?? 0)) * 100) / 100);
  const selectedAddress = addresses.find((item) => item.id === selectedAddressId) ?? addresses[0];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentCalendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const calendarDays = useMemo(() => {
    const firstOfMonth = new Date(subscriptionCalendarMonth.getFullYear(), subscriptionCalendarMonth.getMonth(), 1);
    const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
    const gridStart = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), 1 - mondayOffset);
    return Array.from({ length: 42 }, (_, index) => (
      new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index)
    ));
  }, [subscriptionCalendarMonth]);
  const canGoToPreviousSubscriptionMonth = subscriptionCalendarMonth.getTime() > currentCalendarMonth.getTime();

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
  };

  const updateCartQuantity = (productId: string | number, delta: number) => {
    setCart((current) =>
      current
        .map((item) =>
          item.id === productId ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const openSubscriptionBuilder = (
    productsToSubscribe: Product[],
    existingSubscription?: ProductSubscription | null
  ) => {
    const firstProduct = existingSubscription?.product ?? productsToSubscribe[0];
    if (!firstProduct) return;
    setSubscriptionProductChoices(productsToSubscribe);
    setSubscriptionProduct(firstProduct);
    setProductSubscriptionPlan(existingSubscription?.plan ?? 'Daily');
    setProductSubscriptionQuantity(
      existingSubscription?.quantity ?? cart.find((item) => item.id === firstProduct.id)?.quantity ?? 1
    );
    setProductSubscriptionDays(existingSubscription?.days ?? weekdays);
    if (existingSubscription) {
      setProductSubscriptionStartDate(existingSubscription.startDate);
    }
    setProductSubscriptionEndDate(existingSubscription?.endDate ?? null);
    setIsEditingSubscriptionDate(false);
  };

  const toggleSubscriptionDay = (day: string) => {
    setProductSubscriptionDays((current) =>
      current.includes(day) ? current.filter((selectedDay) => selectedDay !== day) : [...current, day]
    );
  };

  const saveProductSubscription = () => {
    if (!subscriptionProduct) return;
    if (productSubscriptionPlan === 'Weekly' && productSubscriptionDays.length === 0) {
      Alert.alert('Choose delivery days', 'Select at least one day for your weekly subscription.');
      return;
    }

    const newSubscription: ProductSubscription = {
      product: subscriptionProduct,
      plan: productSubscriptionPlan,
      quantity: productSubscriptionQuantity,
      days: productSubscriptionDays,
      startDate: productSubscriptionStartDate,
      endDate: productSubscriptionEndDate,
    };
    setCheckoutSubscription(newSubscription);
    if (!showPayment) {
      setCart((current) => current.some((item) => item.id === subscriptionProduct.id)
        ? current
        : [...current, { ...subscriptionProduct, quantity: 1 }]);
      setShowPayment(true);
    }
    setSubscriptionProduct(null);
    setIsEditingSubscriptionDate(false);
  };

  const renderProductQuantityControl = (product: Product) => {
    const quantity = cart.find((item) => item.id === product.id)?.quantity ?? 0;

    if (quantity === 0) {
      return (
        <TouchableOpacity style={styles.addButton} onPress={() => addToCart(product)}>
          <Text style={styles.addButtonText}>Add</Text>
        </TouchableOpacity>
      );
    }

    return (
      <View style={styles.productQuantityControl}>
        <TouchableOpacity
          accessibilityLabel={`Decrease ${product.name} quantity`}
          style={styles.productQuantityButton}
          onPress={() => updateCartQuantity(product.id, -1)}
        >
          <Text style={styles.productQuantityButtonText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.productQuantityValue}>{quantity}</Text>
        <TouchableOpacity
          accessibilityLabel={`Increase ${product.name} quantity`}
          style={styles.productQuantityButton}
          onPress={() => updateCartQuantity(product.id, 1)}
        >
          <Text style={styles.productQuantityButtonText}>+</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const getGeocodedAddress = async (coordinates: Coordinates) => {
    try {
      const [address] = await Location.reverseGeocodeAsync(coordinates);
      if (!address) return null;
      const line = [
        address.name,
        address.streetNumber,
        address.street,
        address.district,
        address.city,
        address.region,
        address.postalCode,
      ].filter(Boolean).join(', ');
      return {
        line,
        area: address.city || address.district || address.region || 'Selected location',
      };
    } catch {
      return null;
    }
  };

  const openAddressPicker = (address?: Address) => {
    setIsMapExpanded(false);
    setGoogleMapReady(false);
    setGoogleMapFailed(false);
    setEditingAddressId(address?.id ?? null);
    setNewAddressType(address?.label ?? 'Home');
    setNewHouseDetails(address?.houseDetails ?? '');
    setNewLandmark(address?.landmark ?? '');
    setPlaceSearch('');
    setPlaceSuggestions([]);
    setPlacesError(null);
    const addressCoordinates = address?.latitude !== undefined && address.longitude !== undefined
      ? { latitude: address.latitude, longitude: address.longitude }
      : null;
    setSelectedCoordinates(addressCoordinates ?? userCoordinates);
    setSelectedPlaceLabel(address?.line ?? userLocation ?? '');
    setMapRegion({
      ...defaultMapRegion,
      ...(addressCoordinates ?? userCoordinates ?? {}),
    });
    setLocationModalVisible(true);
  };

  const chooseMapLocation = async (coordinates: Coordinates) => {
    setSelectedCoordinates(coordinates);
    setSelectedPlaceLabel('Resolving selected location...');
    const address = await getGeocodedAddress(coordinates);
    setSelectedPlaceLabel(address?.line || `${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)}`);
  };

  const requestCurrentLocation = async () => {
    setIsResolvingLocation(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert('Location permission needed', 'Allow location access or choose a point on the map.');
        return;
      }
      const location = await Location.getCurrentPositionAsync({});
      const coordinates = location.coords;
      setUserCoordinates(coordinates);
      setSelectedCoordinates(coordinates);
      setMapRegion((current) => ({ ...current, ...coordinates }));
      const address = await getGeocodedAddress(coordinates);
      setSelectedPlaceLabel(address?.line || 'Current location');
    } catch {
      Alert.alert('Location unavailable', 'Choose a point on the map instead.');
    } finally {
      setIsResolvingLocation(false);
    }
  };

  const selectPlace = async (suggestion: PlaceSearchResult) => {
    if (suggestion.provider === 'osm') {
      setSelectedCoordinates(suggestion.coordinates);
      setSelectedPlaceLabel(suggestion.description);
      setMapRegion((current) => ({ ...current, ...suggestion.coordinates }));
      setPlaceSearch('');
      setPlaceSuggestions([]);
      return;
    }

    setIsSearchingPlaces(true);
    setPlacesError(null);
    try {
      const response = await fetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(suggestion.placeId)}`,
        {
          headers: {
            'X-Goog-Api-Key': googleMapsApiKey,
            'X-Goog-FieldMask': 'location,formattedAddress,displayName',
          },
        }
      );
      const place = await response.json() as GooglePlaceDetailsResponse & {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(place.error?.message || `Google Place details returned HTTP ${response.status}.`);
      if (!place.location) throw new Error('Google Maps did not return coordinates for this place.');

      setSelectedCoordinates(place.location);
      setSelectedPlaceLabel(place.formattedAddress || place.displayName?.text || suggestion.description);
      setMapRegion((current) => ({ ...current, ...place.location }));
      setPlaceSearch('');
      setPlaceSuggestions([]);
    } catch (error) {
      setPlacesError(error instanceof Error ? error.message : 'Could not load that location.');
    } finally {
      setIsSearchingPlaces(false);
    }
  };

  const handleMapMessage = (message: string) => {
    try {
      const coordinates = JSON.parse(message) as Coordinates;
      if (Number.isFinite(coordinates.latitude) && Number.isFinite(coordinates.longitude)) {
        void chooseMapLocation(coordinates);
      }
    } catch {
      setPlacesError('Could not read the selected map location.');
    }
  };

  const renderOpenStreetMap = () => (
    <WebView
      key={`${mapRegion.latitude}-${mapRegion.longitude}-${selectedCoordinates?.latitude ?? 'none'}-${selectedCoordinates?.longitude ?? 'none'}`}
      style={styles.addressMap}
      source={{ html: createOpenStreetMapHtml(mapRegion, selectedCoordinates) }}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      userAgent="AzadDairyApp/1.0"
      onMessage={({ nativeEvent }) => handleMapMessage(nativeEvent.data)}
    />
  );

  const renderWebMap = () => {
    const center = selectedCoordinates ?? userCoordinates ?? mapRegion;
    const latitudeDelta = Math.max(mapRegion.latitudeDelta, 0.002);
    const longitudeDelta = Math.max(mapRegion.longitudeDelta, 0.002);
    const left = center.longitude - longitudeDelta;
    const right = center.longitude + longitudeDelta;
    const bottom = center.latitude - latitudeDelta;
    const top = center.latitude + latitudeDelta;
    const marker = selectedCoordinates
      ? `&marker=${selectedCoordinates.latitude}%2C${selectedCoordinates.longitude}`
      : '';
    const source = `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik${marker}`;

    return React.createElement('iframe', {
      key: `${center.latitude}-${center.longitude}-${selectedCoordinates?.latitude ?? 'none'}-${selectedCoordinates?.longitude ?? 'none'}`,
      title: 'OpenStreetMap delivery location',
      src: source,
      style: { width: '100%', height: '100%', border: 0 },
    });
  };

  const renderAddressMap = () => (
    Platform.OS === 'web' ? (
      renderWebMap()
    ) : googleMapsEnabled && !googleMapsApiKey ? (
      <View style={[styles.addressMap, styles.addressMapFallback]}>
        <Text style={styles.placesErrorText}>Google Maps is enabled, but its API key is missing from .env.</Text>
      </View>
    ) : googleMapsEnabled && !googleMapFailed ? (
      <MapView
        style={styles.addressMap}
        provider={PROVIDER_GOOGLE}
        region={mapRegion}
        onMapLoaded={() => {
          setGoogleMapReady(true);
          setGoogleMapFailed(false);
        }}
        onRegionChangeComplete={setMapRegion}
        onPress={({ nativeEvent }) => void chooseMapLocation(nativeEvent.coordinate)}
      >
        {selectedCoordinates && (
          <Marker
            coordinate={selectedCoordinates}
            draggable
            onDragEnd={({ nativeEvent }) => void chooseMapLocation(nativeEvent.coordinate)}
          />
        )}
      </MapView>
    ) : googleMapsEnabled && googleMapFailed ? (
      <View style={styles.googleMapFallbackContainer}>
        <View style={styles.googleMapFallbackNotice}>
          <Text style={styles.googleMapFallbackText}>Google map did not load. OpenStreetMap is available for pin selection.</Text>
        </View>
        <View style={styles.googleMapFallbackMap}>{renderOpenStreetMap()}</View>
      </View>
    ) : googleMapsEnabled ? (
      <View style={[styles.addressMap, styles.addressMapFallback]}>
        <Text style={styles.placesErrorText}>Google Maps could not start. Rebuild the app with the configured Maps key.</Text>
      </View>
    ) : (
      renderOpenStreetMap()
    )
  );

  const saveNewAddress = async () => {
    if (!newHouseDetails.trim()) {
      Alert.alert('House details needed', 'Enter your flat, house number, or building name.');
      return;
    }
    if (!selectedCoordinates) {
      Alert.alert('Choose a delivery location', 'Search for a place, use your current location, or tap the map.');
      return;
    }

    const geocodedAddress = await getGeocodedAddress(selectedCoordinates);
    const existingAddress = addresses.find((address) => address.id === editingAddressId);
    const addressLine = selectedPlaceLabel && selectedPlaceLabel !== 'Resolving selected location...'
      ? selectedPlaceLabel
      : geocodedAddress?.line || `${selectedCoordinates.latitude.toFixed(5)}, ${selectedCoordinates.longitude.toFixed(5)}`;
    const nextAddress: Address = {
      id: existingAddress?.id ?? Date.now(),
      label: newAddressType,
      area: geocodedAddress?.area ?? 'Selected location',
      line: addressLine,
      houseDetails: newHouseDetails.trim(),
      landmark: newLandmark.trim() || undefined,
      latitude: selectedCoordinates.latitude,
      longitude: selectedCoordinates.longitude,
      isDefault: existingAddress?.isDefault ?? addresses.length === 0,
    };

    try {
      let savedAddress = nextAddress;
      if (apiEnabled) {
        if (!authToken) throw new Error('Sign in to save a delivery address.');
        const payload = {
          label: newAddressType,
          recipientName: currentUser?.name || '',
          phone: currentUser?.phone || '',
          line1: newHouseDetails.trim(),
          line2: addressLine,
          city: nextAddress.area,
          landmark: nextAddress.landmark || '',
          latitude: selectedCoordinates.latitude,
          longitude: selectedCoordinates.longitude,
          isDefault: nextAddress.isDefault,
        };
        const path = editingAddressId
          ? `/api/me/addresses/${editingAddressId}`
          : '/api/me/addresses';
        const response = await apiRequest<{ addresses: ApiAddress[] }>(path, {
          method: editingAddressId ? 'PATCH' : 'POST',
          body: JSON.stringify(payload),
        }, authToken);
        const mappedAddresses = response.addresses.map(mapApiAddress);
        setAddresses(mappedAddresses);
        savedAddress = mappedAddresses.find((address) => address.id === editingAddressId)
          ?? mappedAddresses[mappedAddresses.length - 1]
          ?? nextAddress;
      } else {
        setAddresses((current) => existingAddress
          ? current.map((address) => address.id === existingAddress.id ? nextAddress : address)
          : [...current, nextAddress]);
      }
      setSelectedAddressId(savedAddress.id);
      setNewHouseDetails('');
      setNewLandmark('');
      setEditingAddressId(null);
      setLocationModalVisible(false);
      Alert.alert('Address saved', `${newAddressType} address saved successfully.`);
    } catch (error) {
      Alert.alert('Address could not be saved', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const setDefaultAddress = async (address: Address) => {
    try {
      if (apiEnabled) {
        if (!authToken) throw new Error('Sign in to update your saved addresses.');
        const response = await apiRequest<{ addresses: ApiAddress[] }>(`/api/me/addresses/${address.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isDefault: true }),
        }, authToken);
        setAddresses(response.addresses.map(mapApiAddress));
      } else {
        setAddresses((current) => current.map((item) => ({ ...item, isDefault: item.id === address.id })));
      }
      setSelectedAddressId(address.id);
    } catch (error) {
      Alert.alert('Address could not be updated', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const removeAddress = async (address: Address) => {
    try {
      let updatedAddresses = addresses.filter((item) => item.id !== address.id);
      if (apiEnabled) {
        if (!authToken) throw new Error('Sign in to remove a saved address.');
        const response = await apiRequest<{ addresses: ApiAddress[] }>(`/api/me/addresses/${address.id}`, {
          method: 'DELETE',
        }, authToken);
        updatedAddresses = response.addresses.map(mapApiAddress);
      }
      setAddresses(updatedAddresses);
      if (selectedAddressId === address.id) {
        const nextDefault = updatedAddresses.find((item) => item.isDefault) ?? updatedAddresses[0];
        setSelectedAddressId(nextDefault?.id ?? '');
      }
    } catch (error) {
      Alert.alert('Address could not be removed', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const confirmRemoveAddress = (address: Address) => {
    Alert.alert('Delete address', 'Remove this saved delivery address?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void removeAddress(address) },
    ]);
  };

  const cancelSubscription = async (subscriptionId: string) => {
    if (!authToken) return;
    try {
      await apiRequest(`/api/me/subscriptions/${subscriptionId}/cancel`, { method: 'PATCH' }, authToken);
      setServerSubscriptions((current) => current.map((subscription) => subscription.id === subscriptionId
        ? { ...subscription, status: 'cancelled' }
        : subscription));
    } catch (error) {
      Alert.alert('Subscription could not be updated', error instanceof Error ? error.message : 'Try again.');
    }
  };

  const refreshServerSubscriptions = async () => {
    if (!authToken) return;
    try {
      const { subscriptions } = await apiRequest<{ subscriptions: ApiSubscription[] }>('/api/me/subscriptions', {}, authToken);
      setServerSubscriptions(subscriptions);
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : 'Subscriptions could not be refreshed.');
    }
  };

  const renderHeader = () => (
    <View style={styles.headerWrap}>
      <View style={styles.headerTop}>
        <View>
          <Text style={styles.headerLabel}>Deliver to</Text>
          <TouchableOpacity onPress={() => openAddressPicker()}>
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
          <TouchableOpacity
            accessibilityLabel="Admin login"
            style={[styles.iconButton, styles.adminPortalButton]}
            onPress={() => void Linking.openURL(resolveApiUrl('/admin/'))}
          >
            <Text style={styles.adminPortalIcon}>▦</Text>
            <Text style={styles.adminPortalLabel}>Admin</Text>
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
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.homeScrollContent}
      showsVerticalScrollIndicator={false}
      scrollEnabled={true}
      nestedScrollEnabled={true}
      overScrollMode="auto"
    >
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
        {visibleCategories.map((category) => {
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

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>{selectedCategory === 'All' ? 'All products' : selectedCategory}</Text>
        <Text style={styles.resultCount}>{visibleProducts.length} items</Text>
      </View>

      <View style={styles.productGrid}>
        {visibleProducts.map((product) => (
          <View key={product.id} style={styles.productCard}>
            <TouchableOpacity activeOpacity={0.85} onPress={() => setSelectedProduct(product)}>
              <View style={styles.productImageWrap}>
                {product.images?.[0] ? (
                  <Image source={{ uri: resolveApiUrl(product.images[0]) }} style={styles.productCardImage} resizeMode="cover" />
                ) : (
                  <Text style={styles.productImage}>{product.image}</Text>
                )}
                {!!product.tag && <View style={styles.productBadge}><Text style={styles.productBadgeText}>{product.tag}</Text></View>}
              </View>

              <Text style={styles.productName}>{product.name}</Text>
              <Text style={styles.productDescription}>{product.description}</Text>

              <View style={styles.productMetaRow}>
                <Text style={styles.productRating}>⭐ {product.rating}</Text>
                <Text style={styles.productUnit}>{product.unit}</Text>
              </View>
            </TouchableOpacity>

            <View style={styles.productFooterRow}>
              <View style={styles.productPriceWrap}>
                <Text style={styles.productPrice}>₹{product.price}</Text>
                {(product.originalPrice ?? product.price) > product.price && (
                  <Text style={styles.productOriginalPrice}>₹{product.originalPrice}</Text>
                )}
              </View>
              {renderProductQuantityControl(product)}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
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
                <View style={styles.cartItemIcon}>
                  {item.images?.[0] ? (
                    <Image source={{ uri: resolveApiUrl(item.images[0]) }} style={styles.cartItemImage} resizeMode="cover" />
                  ) : <Text style={styles.productImage}>{item.image}</Text>}
                </View>
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
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.profileScrollContent}
      showsVerticalScrollIndicator={false}
    >
      {renderHeader()}

      {apiEnabled && !currentUser ? (
        <View style={styles.infoCard}>
          <Text style={styles.cardTitle}>{authMode === 'register' ? 'Create your account' : 'Sign in'}</Text>
          <Text style={styles.authIntro}>Your account keeps orders, delivery addresses and subscriptions together.</Text>
          {authMode === 'register' && (
            <>
              <TextInput style={styles.authInput} placeholder="Full name" value={authName} onChangeText={setAuthName} autoCapitalize="words" />
              <TextInput style={styles.authInput} placeholder="Phone number" value={authPhone} onChangeText={setAuthPhone} keyboardType="phone-pad" />
            </>
          )}
          <TextInput style={styles.authInput} placeholder="Email address" value={authEmail} onChangeText={setAuthEmail} autoCapitalize="none" keyboardType="email-address" />
          <TextInput style={styles.authInput} placeholder="Password (at least 8 characters)" value={authPassword} onChangeText={setAuthPassword} secureTextEntry />
          {!!authError && <Text style={styles.authError}>{authError}</Text>}
          {!!serviceError && <Text style={styles.authError}>{serviceError}</Text>}
          <TouchableOpacity style={[styles.primaryButton, isAuthSubmitting && styles.disabledButton]} onPress={() => void submitAuth()} disabled={isAuthSubmitting}>
            <Text style={styles.primaryButtonText}>{isAuthSubmitting ? 'Please wait...' : authMode === 'register' ? 'Create account' : 'Sign in'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.authModeButton} onPress={() => {
            setAuthError(null);
            setAuthMode((mode) => mode === 'register' ? 'login' : 'register');
          }}>
            <Text style={styles.authModeText}>{authMode === 'register' ? 'Already registered? Sign in' : 'New to Azad Dairy? Create an account'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.profileHeaderCard}>
            <View style={styles.profileAvatar}><Text style={styles.profileAvatarText}>{(currentUser?.name || 'A').charAt(0).toUpperCase()}</Text></View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{currentUser?.name ?? 'Anand Sharma'}</Text>
              <Text style={styles.profilePhone}>{currentUser?.phone || currentUser?.email || '+91 98765 43210'}</Text>
            </View>
            {currentUser && <TouchableOpacity style={styles.profileSignOut} onPress={() => void signOut()}><Text style={styles.profileSignOutText}>Sign out</Text></TouchableOpacity>}
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.cardTitle}>Saved addresses</Text>
            {addresses.map((address) => (
              <View key={address.id} style={[styles.addressRow, selectedAddressId === address.id && styles.addressRowSelected]}>
                <Pressable style={styles.addressSelectButton} onPress={() => void setDefaultAddress(address)}>
                  <View style={styles.addressLeft}>
                    <Text style={styles.addressType}>{address.label}</Text>
                    <Text style={styles.addressLine}>{formatAddress(address)}</Text>
                  </View>
                  {address.isDefault && <Text style={styles.defaultTag}>Default</Text>}
                </Pressable>
                <View style={styles.addressRowActions}>
                  <TouchableOpacity accessibilityLabel={`Edit ${address.label} address`} onPress={() => openAddressPicker(address)}>
                    <Text style={styles.addressActionText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityLabel={`Delete ${address.label} address`} onPress={() => confirmRemoveAddress(address)}>
                    <Text style={styles.addressDeleteText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <TouchableOpacity onPress={() => openAddressPicker()} style={styles.secondaryButtonSmall}>
              <Text style={styles.secondaryButtonText}>Add new address</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.cardTitle}>Subscriptions</Text>
            {apiEnabled ? serverSubscriptions.map((item) => (
              <View key={item.id} style={styles.profileSubscriptionRow}>
                <View style={styles.profileSubscriptionHeader}>
                  <Text style={styles.subscriptionInfo}>{item.product?.image || '🥛'}  {item.product?.name || 'Product'}</Text>
                  <Text style={[
                    styles.subscriptionStatus,
                    item.status === 'expired' && styles.subscriptionStatusEnded,
                    item.status === 'cancelled' && styles.subscriptionStatusEnded,
                    item.status === 'scheduled' && styles.subscriptionStatusScheduled,
                  ]}>
                    {item.status === 'expired' ? 'Ended' : item.status === 'scheduled' ? 'Upcoming' : item.status === 'cancelled' ? 'Cancelled' : 'Active'}
                  </Text>
                </View>
                <Text style={styles.profileSubscriptionDetail}>
                  {item.plan}{item.plan === 'Weekly' ? ` · ${item.deliveryDays.join(', ')}` : ''} · Qty {item.quantity}
                </Text>
                <Text style={styles.profileSubscriptionDetail}>
                  {`Starts ${formatSubscriptionDate(new Date(item.startDate))} · Ends ${item.endDate ? formatSubscriptionDate(new Date(item.endDate)) : 'No end date'}`}
                </Text>
                {item.status === 'expired' && <Text style={styles.subscriptionEndedNotice}>This subscription has ended.</Text>}
                {(item.status === 'active' || item.status === 'scheduled') && (
                  <TouchableOpacity style={styles.cancelSubscriptionButton} onPress={() => void cancelSubscription(item.id)}>
                    <Text style={styles.cancelSubscriptionText}>Cancel subscription</Text>
                  </TouchableOpacity>
                )}
              </View>
            )) : activeProductSubscriptions.map((item) => (
              <View key={item.product.id} style={styles.profileSubscriptionRow}>
                <Text style={styles.subscriptionInfo}>{item.product.image}  {item.product.name}</Text>
                <Text style={styles.profileSubscriptionDetail}>
                  {item.plan}{item.plan === 'Weekly' ? ` · ${item.days.join(', ')}` : ''} · Qty {item.quantity}
                </Text>
                <Text style={styles.profileSubscriptionDetail}>
                  {`Starts ${formatSubscriptionDate(item.startDate)} · Ends ${item.endDate ? formatSubscriptionDate(item.endDate) : 'No end date'}`}
                </Text>
              </View>
            ))}
            {(apiEnabled ? serverSubscriptions.length : activeProductSubscriptions.length) === 0 && (
              <Text style={styles.subscriptionInfo}>No subscriptions yet</Text>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );

  const renderPaymentScreen = () => (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F5F7FA" />
      <ScrollView style={styles.paymentScreen} contentContainerStyle={styles.paymentContent}>
        <TouchableOpacity style={styles.backButton} onPress={() => setShowPayment(false)}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.paymentTitle}>Checkout</Text>
        <Text style={styles.paymentSubtitle}>
          Delivery to {selectedAddress?.label} • {selectedAddress ? formatAddress(selectedAddress) : ''}
        </Text>

        <View style={styles.subscriptionCheckoutSection}>
          <Text style={styles.cardTitle}>How would you like your order?</Text>
          <View style={styles.subscriptionChoiceRow}>
            <TouchableOpacity
              style={[styles.subscriptionChoiceButton, !checkoutSubscription && styles.subscriptionChoiceButtonSelected]}
              onPress={() => setCheckoutSubscription(null)}
            >
              <Text style={[styles.subscriptionChoiceText, !checkoutSubscription && styles.subscriptionChoiceTextSelected]}>
                One-time
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.subscriptionChoiceButton, checkoutSubscription && styles.subscriptionChoiceButtonSelected]}
              onPress={() => openSubscriptionBuilder(cart, checkoutSubscription)}
            >
              <Text style={[styles.subscriptionChoiceText, checkoutSubscription && styles.subscriptionChoiceTextSelected]}>
                Subscribe
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.subscriptionCheckoutHint}>Set up a delivery plan for any item in your cart.</Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.cardTitle}>{checkoutSubscription ? 'Order and subscription' : 'Order summary'}</Text>
          {cart.map((item) => (
            <View key={item.id} style={styles.paymentItemRow}>
              <Text style={styles.paymentItemText}>{item.name} x{item.quantity}</Text>
              <View style={styles.paymentPriceWrap}>
                {(item.originalPrice ?? item.price) > item.price && (
                  <Text style={styles.paymentOriginalPrice}>₹{(item.originalPrice ?? item.price) * item.quantity}</Text>
                )}
                <Text style={styles.paymentItemText}>₹{item.price * item.quantity}</Text>
              </View>
            </View>
          ))}
          {productDiscountTotal > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Product savings</Text>
              <Text style={styles.discountValue}>−₹{productDiscountTotal.toFixed(2)}</Text>
            </View>
          )}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Subtotal</Text>
            <Text style={styles.summaryValue}>₹{subtotal}</Text>
          </View>
          {apiEnabled && (
            <View style={styles.couponRow}>
              <TextInput
                style={styles.couponInput}
                value={couponCode}
                onChangeText={(value) => {
                  setCouponCode(value.toUpperCase());
                  setAppliedCoupon(null);
                  setCouponError(null);
                }}
                placeholder="Coupon code"
                autoCapitalize="characters"
              />
              <TouchableOpacity style={styles.couponApplyButton} onPress={() => void applyCoupon()}>
                <Text style={styles.couponApplyText}>Apply</Text>
              </TouchableOpacity>
            </View>
          )}
          {!!couponError && <Text style={styles.couponError}>{couponError}</Text>}
          {appliedCoupon && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Coupon {appliedCoupon.code}</Text>
              <Text style={styles.discountValue}>−₹{appliedCoupon.savings.toFixed(2)}</Text>
            </View>
          )}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Delivery</Text>
            <Text style={styles.summaryValue}>₹{deliveryCharge}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabelStrong}>Total</Text>
            <Text style={styles.summaryValueStrong}>₹{total}</Text>
          </View>
          {checkoutSubscription && (
            <View style={styles.subscriptionOrderDetails}>
              <Text style={styles.subscriptionOrderTitle}>Recurring subscription</Text>
              <Text style={styles.subscriptionOrderProduct}>
                {checkoutSubscription.product.image}  {checkoutSubscription.product.name}
              </Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Plan</Text>
                <Text style={styles.summaryValue}>{checkoutSubscription.plan}</Text>
              </View>
              {checkoutSubscription.plan === 'Weekly' && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Delivery days</Text>
                  <Text style={styles.summaryValue}>{checkoutSubscription.days.join(', ')}</Text>
                </View>
              )}
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Quantity per delivery</Text>
                <Text style={styles.summaryValue}>{checkoutSubscription.quantity}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Starts</Text>
                <Text style={styles.summaryValue}>{formatSubscriptionDate(checkoutSubscription.startDate)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Ends</Text>
                <Text style={styles.summaryValue}>
                  {checkoutSubscription.endDate ? formatSubscriptionDate(checkoutSubscription.endDate) : 'No end date'}
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabelStrong}>Subscription per delivery</Text>
                <Text style={styles.summaryValueStrong}>
                  ₹{checkoutSubscription.product.price * checkoutSubscription.quantity}
                </Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.paymentNotice}>
          <Text style={styles.paymentNoticeTitle}>Payment gateway</Text>
          <Text style={styles.paymentNoticeText}>Integration will be added later. For now this is a frontend-only checkout flow.</Text>
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, isPlacingOrder && styles.disabledButton]}
          disabled={isPlacingOrder}
          onPress={() => void placeOrder()}
        >
          <Text style={styles.primaryButtonText}>
            {isPlacingOrder ? 'Placing order...' : checkoutSubscription ? 'Place order with subscription' : 'Place order'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );

  const placeOrder = async () => {
    if (apiEnabled && !authToken) {
      Alert.alert('Sign in required', 'Create an account or sign in before placing an order.');
      setShowPayment(false);
      setActiveTab('Profile');
      return;
    }
    if (apiEnabled && !selectedAddress) {
      Alert.alert('Delivery address required', 'Add a delivery address to your account before placing this order.');
      setShowPayment(false);
      setActiveTab('Profile');
      return;
    }

    if (apiEnabled && authToken) {
      setIsPlacingOrder(true);
      try {
        const result = await apiRequest<{
          order: ApiOrder;
          subscription: ApiSubscription | null;
        }>('/api/orders', {
          method: 'POST',
          body: JSON.stringify({
            items: cart.map((item) => ({ productId: String(item.id), quantity: item.quantity })),
            couponCode: appliedCoupon?.code || '',
            addressId: selectedAddressId ? String(selectedAddressId) : undefined,
            subscription: checkoutSubscription ? {
              productId: String(checkoutSubscription.product.id),
              plan: checkoutSubscription.plan,
              quantity: checkoutSubscription.quantity,
              deliveryDays: checkoutSubscription.days,
              startDate: checkoutSubscription.startDate.toISOString().slice(0, 10),
              endDate: checkoutSubscription.endDate?.toISOString().slice(0, 10) ?? null,
            } : undefined,
          }),
        }, authToken);

        if (result.subscription) {
          const { subscriptions } = await apiRequest<{ subscriptions: ApiSubscription[] }>('/api/me/subscriptions', {}, authToken);
          setServerSubscriptions(subscriptions);
        }
        setCart([]);
        setCheckoutSubscription(null);
        setAppliedCoupon(null);
        setCouponCode('');
        setShowPayment(false);
        setActiveTab('Home');
        const subscriptionConfirmation = result.order.subscriptionSnapshot
          ? `\n\nSubscription: ${result.order.subscriptionSnapshot.productName}\nPlan: ${result.order.subscriptionSnapshot.plan}\nQuantity: ${result.order.subscriptionSnapshot.quantity} per delivery\nStarts: ${formatSubscriptionDate(new Date(result.order.subscriptionSnapshot.startDate))}\nEnds: ${result.order.subscriptionSnapshot.endDate ? formatSubscriptionDate(new Date(result.order.subscriptionSnapshot.endDate)) : 'No end date'}${result.order.subscriptionSnapshot.deliveryDays.length ? `\nDelivery days: ${result.order.subscriptionSnapshot.deliveryDays.join(', ')}` : ''}`
          : '';
        Alert.alert('Order placed', `Order ${result.order.orderNumber}\nTotal: ₹${result.order.total}${subscriptionConfirmation}`);
      } catch (error) {
        Alert.alert('Order could not be placed', error instanceof Error ? error.message : 'Check your connection and try again.');
      } finally {
        setIsPlacingOrder(false);
      }
      return;
    }

    if (checkoutSubscription) {
      const orderedSubscription = checkoutSubscription;
      setActiveProductSubscriptions((current) => [
        ...current.filter((item) => item.product.id !== orderedSubscription.product.id),
        orderedSubscription,
      ]);
      const deliveryDays = orderedSubscription.plan === 'Weekly'
        ? `\nDelivery days: ${orderedSubscription.days.join(', ')}`
        : '';
      Alert.alert(
        'Order placed with subscription',
        `Your cart order has been placed.\n\nSubscription: ${orderedSubscription.product.name}\nPlan: ${orderedSubscription.plan}${deliveryDays}\nQuantity: ${orderedSubscription.quantity} per delivery\nStarts: ${formatSubscriptionDate(orderedSubscription.startDate)}\nSubscription per delivery: ₹${orderedSubscription.product.price * orderedSubscription.quantity}`
      );
    } else {
      Alert.alert('Order placed', 'Your order has been placed successfully.');
    }
    setCart([]);
    setCheckoutSubscription(null);
    setAppliedCoupon(null);
    setCouponCode('');
    setShowPayment(false);
    setActiveTab('Home');
  };

  const renderMainContent = () => {
    if (showPayment) return renderPaymentScreen();

    switch (activeTab) {
      case 'Home':
        return renderHomeContent();
      case 'Cart':
        return renderCartContent();
      case 'Profile':
        return renderProfileContent();
      default:
        return renderHomeContent();
    }
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor="#F5F7FA" />
        {renderMainContent()}

        {!showPayment && (
          <View style={styles.bottomTabbar}>
            {(['Home', 'Cart', 'Profile'] as TabName[]).map((tab) => {
              const isSelected = activeTab === tab;
              const iconMap: Record<TabName, string> = {
                Home: '⌂',
                Cart: '🛒',
                Profile: '👤',
              };
              return (
                <TouchableOpacity key={tab} style={styles.tabItem} onPress={() => {
                  setActiveTab(tab);
                  if (tab === 'Profile' && apiEnabled && authToken) void refreshServerSubscriptions();
                }}>
                  <Text style={[styles.tabIcon, isSelected && styles.tabIconSelected]}>{iconMap[tab]}</Text>
                  <Text style={[styles.tabText, isSelected && styles.tabTextSelected]}>{tab}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

      <Modal
        visible={selectedProduct !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedProduct(null)}
      >
        <View style={styles.productDetailOverlay}>
          <View style={styles.productDetailCard}>
            {selectedProduct && (
              <>
                <View style={styles.productDetailHeader}>
                  <Text style={styles.productDetailCategory}>
                    {selectedProduct.category} • {selectedProduct.unit}
                  </Text>
                  <TouchableOpacity
                    accessibilityLabel="Close product details"
                    style={styles.productDetailCloseButton}
                    onPress={() => setSelectedProduct(null)}
                  >
                    <Text style={styles.productDetailCloseText}>×</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.productDetailImageWrap}>
                  {selectedProduct.images?.[0] ? (
                    <Image source={{ uri: resolveApiUrl(selectedProduct.images[0]) }} style={styles.productDetailImageAsset} resizeMode="contain" />
                  ) : <Text style={styles.productDetailImage}>{selectedProduct.image}</Text>}
                </View>
                <Text style={styles.productDetailName}>{selectedProduct.name}</Text>
                <Text style={styles.productDetailDescription}>{selectedProduct.description}</Text>
                <View style={styles.productDetailRatingRow}>
                  <Text style={styles.productRating}>⭐ {selectedProduct.rating}</Text>
                  <Text style={styles.productBadgeText}>{selectedProduct.tag}</Text>
                </View>

                <View style={styles.productDetailFooter}>
                  <View>
                    <Text style={styles.productDetailPriceLabel}>Price</Text>
                    <Text style={styles.productPrice}>₹{selectedProduct.price}</Text>
                    {(selectedProduct.originalPrice ?? selectedProduct.price) > selectedProduct.price && (
                      <Text style={styles.productOriginalPrice}>₹{selectedProduct.originalPrice}</Text>
                    )}
                  </View>
                  {renderProductQuantityControl(selectedProduct)}
                </View>
                <TouchableOpacity
                  style={styles.productDetailSubscribeButton}
                  onPress={() => {
                    openSubscriptionBuilder([selectedProduct]);
                    setSelectedProduct(null);
                  }}
                >
                  <Text style={styles.productDetailSubscribeText}>Set up subscription</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={subscriptionProduct !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setSubscriptionProduct(null);
          setIsEditingSubscriptionDate(false);
        }}
      >
        <View style={styles.subscriptionSheetOverlay}>
          <View style={styles.subscriptionSheet}>
            {subscriptionProduct && (
              <>
                <View style={styles.subscriptionSheetHeader}>
                  <View style={styles.subscriptionSheetHeading}>
                    <Text style={styles.subscriptionSheetIcon}>▦</Text>
                    <View style={styles.subscriptionSheetTitleWrap}>
                      <Text style={styles.subscriptionSheetTitle}>Subscribe</Text>
                      <Text style={styles.subscriptionSheetSubtitle}>Set it once and enjoy automatic deliveries</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    accessibilityLabel="Close subscription setup"
                    style={styles.subscriptionCloseButton}
                    onPress={() => {
                      setSubscriptionProduct(null);
                      setIsEditingSubscriptionDate(false);
                    }}
                  >
                    <Text style={styles.productDetailCloseText}>×</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView
                  style={styles.subscriptionSheetScroll}
                  contentContainerStyle={styles.subscriptionSheetContent}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {subscriptionProductChoices.length > 1 && (
                    <View>
                      <Text style={styles.subscriptionItemLabel}>Choose a product</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subscriptionItemRow}>
                        {subscriptionProductChoices.map((product) => {
                          const isSelected = subscriptionProduct.id === product.id;
                          return (
                            <TouchableOpacity
                              key={product.id}
                              accessibilityRole="button"
                              accessibilityState={{ selected: isSelected }}
                              style={[styles.subscriptionItemChip, isSelected && styles.subscriptionItemChipSelected]}
                              onPress={() => {
                                setSubscriptionProduct(product);
                                setProductSubscriptionPlan('Daily');
                                setProductSubscriptionQuantity(cart.find((item) => item.id === product.id)?.quantity ?? 1);
                                setProductSubscriptionDays(weekdays);
                              }}
                            >
                              <Text style={styles.subscriptionItemEmoji}>{product.image}</Text>
                              <Text
                                numberOfLines={1}
                                style={[styles.subscriptionItemText, isSelected && styles.subscriptionItemTextSelected]}
                              >
                                {product.name}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                  )}
                  <View style={styles.subscriptionProductCard}>
                    <View style={styles.subscriptionProductImage}>
                      {subscriptionProduct.images?.[0] ? (
                        <Image source={{ uri: resolveApiUrl(subscriptionProduct.images[0]) }} style={styles.subscriptionProductImageAsset} resizeMode="cover" />
                      ) : <Text style={styles.subscriptionProductEmoji}>{subscriptionProduct.image}</Text>}
                    </View>
                    <View style={styles.subscriptionProductDetails}>
                      <Text style={styles.subscriptionProductName}>{subscriptionProduct.name}</Text>
                      <Text style={styles.subscriptionProductUnit}>{subscriptionProduct.unit}</Text>
                    </View>
                    <Text style={styles.subscriptionProductPrice}>₹{subscriptionProduct.price}</Text>
                  </View>

                  <View style={styles.subscriptionStepCard}>
                    <View style={styles.subscriptionSectionHeading}>
                      <Text style={styles.subscriptionStepNumber}>1</Text>
                      <View style={styles.subscriptionSectionTitleWrap}>
                        <Text style={styles.subscriptionSectionTitle}>Selected plan</Text>
                        <Text style={styles.subscriptionSectionHint}>Choose how often it arrives</Text>
                      </View>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subscriptionPlanRow}>
                      {subscriptionPlans.map((plan) => (
                        <TouchableOpacity
                          key={plan}
                          accessibilityRole="button"
                          accessibilityState={{ selected: productSubscriptionPlan === plan }}
                          style={[styles.subscriptionPlanButton, productSubscriptionPlan === plan && styles.subscriptionPlanButtonSelected]}
                          onPress={() => setProductSubscriptionPlan(plan)}
                        >
                          <Text style={[styles.subscriptionPlanText, productSubscriptionPlan === plan && styles.subscriptionPlanTextSelected]}>
                            {plan}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <Text style={styles.subscriptionPlanDescription}>
                      {productSubscriptionPlan === 'Daily' && 'Delivered every day'}
                      {productSubscriptionPlan === 'Weekly' && 'Get delivery on selected days every week'}
                      {productSubscriptionPlan === 'Alternate' && 'Delivered every other day'}
                      {productSubscriptionPlan === 'Monthly' && 'Delivered once each month'}
                    </Text>
                    {productSubscriptionPlan === 'Weekly' && (
                      <>
                        <View style={styles.subscriptionPresetRow}>
                          <TouchableOpacity style={styles.subscriptionPresetButton} onPress={() => setProductSubscriptionDays(weekdays.slice(0, 5))}>
                            <Text style={styles.subscriptionPresetText}>Weekdays</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.subscriptionPresetButton} onPress={() => setProductSubscriptionDays(weekdays.slice(5))}>
                            <Text style={styles.subscriptionPresetText}>Weekends</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.subscriptionDayRow}>
                          {weekdays.map((day) => {
                            const isSelected = productSubscriptionDays.includes(day);
                            return (
                              <TouchableOpacity
                                key={day}
                                accessibilityLabel={`${day}${isSelected ? ', selected' : ''}`}
                                accessibilityRole="button"
                                accessibilityState={{ selected: isSelected }}
                                style={[styles.subscriptionDayButton, isSelected && styles.subscriptionDayButtonSelected]}
                                onPress={() => toggleSubscriptionDay(day)}
                              >
                                <Text style={[styles.subscriptionDayText, isSelected && styles.subscriptionDayTextSelected]}>{day}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      </>
                    )}
                  </View>

                  <View style={styles.subscriptionStepCard}>
                    <View style={styles.subscriptionSectionHeading}>
                      <Text style={styles.subscriptionStepNumber}>2</Text>
                      <View style={styles.subscriptionSectionTitleWrap}>
                        <Text style={styles.subscriptionSectionTitle}>Quantity</Text>
                        <Text style={styles.subscriptionSectionHint}>
                          {productSubscriptionPlan === 'Daily' ? 'Quantity delivered each day' : 'Quantity per delivery'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.subscriptionQuantityRow}>
                      <Text style={styles.subscriptionQuantityLabel}>Per delivery</Text>
                      <View style={styles.subscriptionQuantityControl}>
                        <TouchableOpacity
                          accessibilityLabel="Decrease subscription quantity"
                          style={styles.subscriptionQuantityButton}
                          onPress={() => setProductSubscriptionQuantity((quantity) => Math.max(1, quantity - 1))}
                        >
                          <Text style={styles.subscriptionQuantityButtonText}>−</Text>
                        </TouchableOpacity>
                        <Text style={styles.subscriptionQuantityValue}>{productSubscriptionQuantity}</Text>
                        <TouchableOpacity
                          accessibilityLabel="Increase subscription quantity"
                          style={[styles.subscriptionQuantityButton, styles.subscriptionQuantityButtonPrimary]}
                          onPress={() => setProductSubscriptionQuantity((quantity) => quantity + 1)}
                        >
                          <Text style={[styles.subscriptionQuantityButtonText, styles.subscriptionQuantityButtonTextPrimary]}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>

                  <View style={styles.subscriptionStepCard}>
                    <View style={styles.subscriptionSectionHeading}>
                      <Text style={styles.subscriptionStepNumber}>3</Text>
                      <View style={styles.subscriptionSectionTitleWrap}>
                        <Text style={styles.subscriptionSectionTitle}>Start date</Text>
                        <Text style={styles.subscriptionSectionHint}>First delivery date</Text>
                      </View>
                      <Text style={styles.subscriptionStartDate}>
                        {formatSubscriptionDate(productSubscriptionStartDate)}
                      </Text>
                      <TouchableOpacity
                        onPress={() => {
                          if (!isEditingSubscriptionDate) {
                            setSubscriptionCalendarMonth(new Date(
                              productSubscriptionStartDate.getFullYear(),
                              productSubscriptionStartDate.getMonth(),
                              1
                            ));
                          }
                          setIsEditingSubscriptionDate((editing) => !editing);
                        }}
                      >
                        <Text style={styles.subscriptionDateEdit}>{isEditingSubscriptionDate ? 'Done' : 'Edit'}</Text>
                      </TouchableOpacity>
                    </View>
                    {isEditingSubscriptionDate && (
                      <View style={styles.subscriptionCalendar}>
                        <View style={styles.subscriptionCalendarHeader}>
                          <TouchableOpacity
                            accessibilityLabel="Previous month"
                            accessibilityState={{ disabled: !canGoToPreviousSubscriptionMonth }}
                            disabled={!canGoToPreviousSubscriptionMonth}
                            style={[styles.subscriptionCalendarNavButton, !canGoToPreviousSubscriptionMonth && styles.subscriptionCalendarNavButtonDisabled]}
                            onPress={() => setSubscriptionCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                          >
                            <Text style={styles.subscriptionCalendarNavText}>‹</Text>
                          </TouchableOpacity>
                          <Text style={styles.subscriptionCalendarMonth}>
                            {subscriptionCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                          </Text>
                          <TouchableOpacity
                            accessibilityLabel="Next month"
                            style={styles.subscriptionCalendarNavButton}
                            onPress={() => setSubscriptionCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                          >
                            <Text style={styles.subscriptionCalendarNavText}>›</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.subscriptionCalendarWeekdays}>
                          {weekdays.map((day) => (
                            <Text key={day} style={styles.subscriptionCalendarWeekday}>{day}</Text>
                          ))}
                        </View>
                        <View style={styles.subscriptionCalendarGrid}>
                          {calendarDays.map((day) => {
                            const isCurrentMonth = day.getMonth() === subscriptionCalendarMonth.getMonth();
                            const isPast = day.getTime() < today.getTime();
                            const isToday = isSameCalendarDay(day, today);
                            const isSelected = isSameCalendarDay(day, productSubscriptionStartDate);
                            if (!isCurrentMonth) {
                              return <View key={day.toISOString()} style={styles.subscriptionCalendarCell} />;
                            }
                            return (
                              <View key={day.toISOString()} style={styles.subscriptionCalendarCell}>
                                <TouchableOpacity
                                  accessibilityRole="button"
                                  accessibilityLabel={day.toLocaleDateString('en-US', { dateStyle: 'full' })}
                                  accessibilityState={{ disabled: isPast, selected: isSelected }}
                                  disabled={isPast}
                                  style={[
                                    styles.subscriptionCalendarDay,
                                    isToday && styles.subscriptionCalendarDayToday,
                                    isSelected && styles.subscriptionCalendarDaySelected,
                                    isPast && styles.subscriptionCalendarDayDisabled,
                                  ]}
                                  onPress={() => {
                                    setProductSubscriptionStartDate(day);
                                    setIsEditingSubscriptionDate(false);
                                  }}
                                >
                                  <Text
                                    style={[
                                      styles.subscriptionCalendarDayText,
                                      isSelected && styles.subscriptionCalendarDayTextSelected,
                                      isPast && styles.subscriptionCalendarDayTextDisabled,
                                    ]}
                                  >
                                    {day.getDate()}
                                  </Text>
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                        </View>
                      </View>
                    )}
                  </View>
                </ScrollView>

                <View style={styles.subscriptionSheetFooter}>
                  <View style={styles.subscriptionFooterProduct}>
                    {subscriptionProduct.images?.[0] ? (
                      <Image source={{ uri: resolveApiUrl(subscriptionProduct.images[0]) }} style={styles.subscriptionFooterImage} resizeMode="cover" />
                    ) : <Text style={styles.subscriptionFooterEmoji}>{subscriptionProduct.image}</Text>}
                    <View style={styles.subscriptionFooterTextWrap}>
                      <Text style={styles.subscriptionFooterPlan}>{productSubscriptionPlan}</Text>
                      <Text style={styles.subscriptionFooterMeta}>
                        {productSubscriptionQuantity} × ₹{subscriptionProduct.price} per delivery
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity style={styles.subscriptionSubmitButton} onPress={saveProductSubscription}>
                    <Text style={styles.subscriptionSubmitText}>Subscribe now</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={locationModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (isMapExpanded) setIsMapExpanded(false);
          else setLocationModalVisible(false);
        }}
      >
        {isMapExpanded ? (
          <View style={styles.fullscreenMapOverlay}>
            <SafeAreaView style={styles.fullscreenMapContent} edges={['top', 'bottom']}>
              <View style={styles.fullscreenMapHeader}>
                <TouchableOpacity
                  accessibilityLabel="Return to address form"
                  style={styles.fullscreenMapBackButton}
                  onPress={() => {
                    setGoogleMapReady(false);
                    setGoogleMapFailed(false);
                    setIsMapExpanded(false);
                  }}
                >
                  <Text style={styles.fullscreenMapBackText}>‹</Text>
                </TouchableOpacity>
                <View style={styles.fullscreenMapHeading}>
                  <Text style={styles.fullscreenMapTitle}>Choose delivery point</Text>
                  <Text style={styles.fullscreenMapSubtitle} numberOfLines={1}>
                    {selectedPlaceLabel || 'Tap or drag the pin on the map'}
                  </Text>
                </View>
              </View>

              <View style={styles.fullscreenMapCanvas}>{renderAddressMap()}</View>

              <View style={styles.fullscreenMapFooter}>
                <Text style={styles.fullscreenMapHint}>
                  Pin location selected. You can still adjust it on the map.
                </Text>
                <TouchableOpacity
                  style={[styles.primaryButton, styles.fullscreenMapConfirmButton]}
                  onPress={() => {
                    setGoogleMapReady(false);
                    setGoogleMapFailed(false);
                    setIsMapExpanded(false);
                  }}
                  disabled={!selectedCoordinates}
                >
                  <Text style={styles.primaryButtonText}>Use this location</Text>
                </TouchableOpacity>
              </View>
            </SafeAreaView>
          </View>
        ) : (
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            ref={addressScrollRef}
            style={styles.modalCard}
            contentContainerStyle={styles.addressModalContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            nestedScrollEnabled
          >
            <View style={styles.modalHeader}>
              <Text style={styles.cardTitle}>Select delivery location</Text>
              <TouchableOpacity onPress={() => setLocationModalVisible(false)}>
                <Text style={styles.modalCloseButton}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>Saved addresses</Text>
            <View style={styles.addressListWrap}>
              {addresses.map((address) => (
                <TouchableOpacity
                  key={address.id}
                  style={[styles.savedAddressRow, selectedAddressId === address.id && styles.savedAddressRowSelected]}
                  onPress={() => {
                    setSelectedAddressId(address.id);
                    setLocationModalVisible(false);
                  }}
                >
                  <View style={styles.addressIconWrap}>
                    <Text style={styles.addressIcon}>
                      {address.label === 'Home' ? '🏠' : address.label === 'Office' ? '💼' : '📍'}
                    </Text>
                  </View>
                  <View style={styles.addressDetails}>
                    <Text style={styles.addressTypeTitle}>{address.label}</Text>
                    <Text style={styles.addressLineText} numberOfLines={2}>{formatAddress(address)}</Text>
                  </View>
                  {selectedAddressId === address.id && (
                    <View style={styles.addressCheckmark}>
                      <Text style={styles.checkmarkText}>✓</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.dividerLine} />

            <Text style={styles.modalSubtitle}>Add new address</Text>
            <View style={styles.addressTypeRow}>
              {(['Home', 'Office', 'Other'] as AddressType[]).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.addressTypeButton, newAddressType === type && styles.addressTypeButtonSelected]}
                  onPress={() => setNewAddressType(type)}
                >
                  <Text style={[styles.addressTypeText, newAddressType === type && styles.addressTypeTextSelected]}>
                    {type === 'Home' ? '🏠' : type === 'Office' ? '💼' : '📍'} {type}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.placeSearchRow}>
              <TextInput
                placeholder="Type an area, street, or landmark"
                value={placeSearch}
                onChangeText={(text) => {
                  setPlaceSearch(text);
                  setPlaceSuggestions([]);
                  setPlacesError(null);
                }}
                style={[styles.addressTextInput, styles.placeSearchInput]}
                placeholderTextColor="#9CA3AF"
                autoCorrect={false}
              />
            </View>
            <Text style={styles.placesHelperText}>
              {googleMapsEnabled
                ? 'Suggestions are from Google Places near the selected map location.'
                : 'Suggestions are based on OpenStreetMap data and nearby map location.'}
            </Text>
            {isSearchingPlaces && <Text style={styles.placesHelperText}>Searching places...</Text>}
            {placesError && <Text style={styles.placesErrorText}>{placesError}</Text>}
            {placeSuggestions.length > 0 && (
              <View style={styles.placesSuggestions}>
                {placeSuggestions.map((suggestion) => (
                  <TouchableOpacity
                    key={suggestion.placeId}
                    style={styles.placeSuggestion}
                    onPress={() => selectPlace(suggestion)}
                  >
                    <Text style={styles.placeSuggestionTitle}>{suggestion.mainText}</Text>
                    {!!suggestion.secondaryText && (
                      <Text style={styles.placeSuggestionSubtitle}>{suggestion.secondaryText}</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={styles.mapInstruction}>Tap the map or drag the pin to choose the delivery point.</Text>
            <TouchableOpacity
              style={styles.expandMapButton}
              onPress={() => {
                setGoogleMapReady(false);
                setGoogleMapFailed(false);
                setIsMapExpanded(true);
              }}
            >
              <Text style={styles.expandMapButtonText}>Open map full screen</Text>
            </TouchableOpacity>
            <View style={styles.addressMapWrap}>
              {renderAddressMap()}
            </View>
            <TouchableOpacity
              style={styles.useCurrentLocationButton}
              onPress={() => void requestCurrentLocation()}
              disabled={isResolvingLocation}
            >
              <Text style={styles.useCurrentLocationText}>
                {isResolvingLocation ? 'Finding location...' : 'Use current location'}
              </Text>
            </TouchableOpacity>
            {!!selectedPlaceLabel && (
              <Text style={styles.selectedLocationText} numberOfLines={2}>{selectedPlaceLabel}</Text>
            )}

            <TextInput
              placeholder="Flat, house number, building, street"
              value={newHouseDetails}
              onChangeText={setNewHouseDetails}
              onFocus={scrollAddressFormIntoView}
              style={styles.addressTextInput}
              placeholderTextColor="#9CA3AF"
            />
            <TextInput
              placeholder="Nearby landmark (optional)"
              value={newLandmark}
              onChangeText={setNewLandmark}
              onFocus={scrollAddressFormIntoView}
              style={styles.addressTextInput}
              placeholderTextColor="#9CA3AF"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setLocationModalVisible(false)}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryButton, styles.addressSaveButton]} onPress={() => void saveNewAddress()}>
                <Text style={styles.primaryButtonText}>Save address</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
        )}
      </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
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
    paddingTop: Platform.OS === 'android' ? 8 : 0,
  },
  homeScrollContent: {
    paddingHorizontal: isSmallScreen ? 12 : 16,
    paddingBottom: 110,
    paddingTop: Platform.OS === 'android' ? 8 : 0,
  },
  profileScrollContent: {
    paddingHorizontal: isSmallScreen ? 12 : 16,
    paddingBottom: 110,
    paddingTop: Platform.OS === 'android' ? 8 : 0,
  },
  headerWrap: {
    paddingTop: Platform.OS === 'android' ? 16 : 12,
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
    paddingBottom: 12,
    paddingTop: 4,
  },
  categoryPill: {
    minWidth: isSmallScreen ? 80 : 92,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  categoryPillSelected: {
    borderColor: '#0B7B63',
    backgroundColor: '#D4F8E8',
    elevation: 5,
    shadowColor: '#0B7B63',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
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
  subscriptionCheckoutSection: {
    marginBottom: 8,
  },
  subscriptionCheckoutHint: {
    marginTop: 10,
    color: '#6B7280',
    fontSize: 12,
  },
  subscriptionOrderDetails: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  subscriptionOrderTitle: {
    color: '#0B7B63',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 8,
  },
  subscriptionOrderProduct: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  profileSubscriptionRow: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  profileSubscriptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  subscriptionStatus: {
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#E4F4EE',
    color: '#0B7B63',
    fontSize: 10,
    fontWeight: '800',
  },
  subscriptionStatusEnded: {
    backgroundColor: '#FEE4E2',
    color: '#B42318',
  },
  subscriptionStatusScheduled: {
    backgroundColor: '#FFF4D6',
    color: '#946200',
  },
  subscriptionEndedNotice: {
    marginTop: 7,
    color: '#B42318',
    fontSize: 12,
    fontWeight: '700',
  },
  cancelSubscriptionButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    marginTop: 3,
  },
  cancelSubscriptionText: {
    color: '#B42318',
    fontSize: 12,
    fontWeight: '700',
  },
  profileSubscriptionDetail: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 4,
    marginLeft: 26,
  },
  productDetailSubscribeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: '#0B7B63',
  },
  productDetailSubscribeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  subscriptionSheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
  },
  subscriptionSheet: {
    width: '100%',
    height: '92%',
    maxHeight: 800,
    alignSelf: 'center',
    backgroundColor: '#F3F5F4',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  subscriptionSheetHeader: {
    minHeight: 76,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
  },
  subscriptionSheetHeading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  subscriptionSheetIcon: {
    width: 38,
    height: 38,
    lineHeight: 38,
    textAlign: 'center',
    color: '#0B7B63',
    fontSize: 28,
    fontWeight: '700',
    marginRight: 10,
  },
  subscriptionSheetTitleWrap: {
    flex: 1,
  },
  subscriptionSheetTitle: {
    color: '#111827',
    fontSize: 21,
    fontWeight: '800',
  },
  subscriptionSheetSubtitle: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 2,
  },
  subscriptionCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  subscriptionSheetScroll: {
    flex: 1,
  },
  subscriptionSheetContent: {
    padding: 14,
    paddingBottom: 18,
    gap: 10,
  },
  subscriptionItemLabel: {
    color: '#4B5563',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 7,
  },
  subscriptionItemRow: {
    gap: 8,
    paddingBottom: 2,
  },
  subscriptionItemChip: {
    maxWidth: 220,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
  },
  subscriptionItemChipSelected: {
    borderColor: '#0B7B63',
    backgroundColor: '#E4F4EE',
  },
  subscriptionItemEmoji: {
    fontSize: 16,
    marginRight: 6,
  },
  subscriptionItemText: {
    flexShrink: 1,
    color: '#4B5563',
    fontSize: 12,
    fontWeight: '600',
  },
  subscriptionItemTextSelected: {
    color: '#0B7B63',
  },
  subscriptionProductCard: {
    minHeight: 104,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
  },
  subscriptionProductImage: {
    width: 62,
    height: 62,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
    marginRight: 12,
  },
  subscriptionProductEmoji: {
    fontSize: 34,
  },
  subscriptionProductDetails: {
    flex: 1,
    marginRight: 8,
  },
  subscriptionProductName: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  subscriptionProductUnit: {
    color: '#6B7280',
    fontSize: 13,
    marginTop: 5,
  },
  subscriptionProductPrice: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  subscriptionStepCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
  },
  subscriptionSectionHeading: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
  },
  subscriptionStepNumber: {
    width: 26,
    height: 26,
    lineHeight: 26,
    borderRadius: 13,
    overflow: 'hidden',
    textAlign: 'center',
    color: '#FFFFFF',
    backgroundColor: '#111827',
    fontSize: 13,
    fontWeight: '800',
    marginRight: 10,
  },
  subscriptionSectionTitleWrap: {
    flex: 1,
  },
  subscriptionSectionTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  subscriptionSectionHint: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 3,
  },
  subscriptionPlanRow: {
    paddingTop: 14,
    paddingBottom: 2,
    gap: 8,
  },
  subscriptionPlanButton: {
    minWidth: 78,
    minHeight: 44,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  subscriptionPlanButtonSelected: {
    borderColor: '#0B7B63',
    backgroundColor: '#0B7B63',
  },
  subscriptionPlanText: {
    color: '#4B5563',
    fontSize: 13,
    fontWeight: '700',
  },
  subscriptionPlanTextSelected: {
    color: '#FFFFFF',
  },
  subscriptionPlanDescription: {
    color: '#6B7280',
    fontSize: 13,
    marginTop: 10,
  },
  subscriptionPresetRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  subscriptionPresetButton: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
  },
  subscriptionPresetText: {
    color: '#4B5563',
    fontSize: 13,
    fontWeight: '600',
  },
  subscriptionDayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    gap: 6,
  },
  subscriptionDayButton: {
    flex: 1,
    minWidth: 32,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  subscriptionDayButtonSelected: {
    borderColor: '#0B7B63',
    backgroundColor: '#0B7B63',
  },
  subscriptionDayText: {
    color: '#4B5563',
    fontSize: 12,
    fontWeight: '700',
  },
  subscriptionDayTextSelected: {
    color: '#FFFFFF',
  },
  subscriptionQuantityRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#F7F8F8',
  },
  subscriptionQuantityLabel: {
    color: '#4B5563',
    fontSize: 13,
    fontWeight: '600',
  },
  subscriptionQuantityControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  subscriptionQuantityButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#E5E7EB',
  },
  subscriptionQuantityButtonPrimary: {
    backgroundColor: '#0B7B63',
  },
  subscriptionQuantityButtonText: {
    color: '#374151',
    fontSize: 22,
    lineHeight: 25,
    fontWeight: '600',
  },
  subscriptionQuantityButtonTextPrimary: {
    color: '#FFFFFF',
  },
  subscriptionQuantityValue: {
    minWidth: 18,
    textAlign: 'center',
    color: '#111827',
    fontSize: 15,
    fontWeight: '800',
  },
  subscriptionStartDate: {
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 9,
    backgroundColor: '#E4F4EE',
    color: '#0B7B63',
    fontSize: 13,
    fontWeight: '800',
    marginLeft: 'auto',
    marginRight: 10,
  },
  subscriptionDateEdit: {
    color: '#0B7B63',
    fontSize: 13,
    fontWeight: '700',
  },
  subscriptionCalendar: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  subscriptionCalendarHeader: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  subscriptionCalendarNavButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
  },
  subscriptionCalendarNavButtonDisabled: {
    opacity: 0.4,
  },
  subscriptionCalendarNavText: {
    color: '#374151',
    fontSize: 23,
    lineHeight: 26,
  },
  subscriptionCalendarMonth: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
  },
  subscriptionCalendarWeekdays: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  subscriptionCalendarWeekday: {
    width: '14.2857%',
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 6,
  },
  subscriptionCalendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  subscriptionCalendarCell: {
    width: '14.2857%',
    height: 40,
    padding: 2,
  },
  subscriptionCalendarDay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#F3F4F6',
  },
  subscriptionCalendarDayToday: {
    borderWidth: 1,
    borderColor: '#0B7B63',
  },
  subscriptionCalendarDaySelected: {
    backgroundColor: '#0B7B63',
  },
  subscriptionCalendarDayDisabled: {
    backgroundColor: '#F9FAFB',
  },
  subscriptionCalendarDayText: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '600',
  },
  subscriptionCalendarDayTextSelected: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  subscriptionCalendarDayTextDisabled: {
    color: '#C4C9D0',
  },
  subscriptionSheetFooter: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'android' ? 12 : 18,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  subscriptionFooterProduct: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
  },
  subscriptionFooterEmoji: {
    width: 42,
    height: 42,
    lineHeight: 42,
    textAlign: 'center',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
    fontSize: 25,
    marginRight: 9,
  },
  subscriptionFooterTextWrap: {
    flex: 1,
  },
  subscriptionFooterPlan: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '800',
  },
  subscriptionFooterMeta: {
    color: '#6B7280',
    fontSize: 11,
    marginTop: 3,
  },
  subscriptionSubmitButton: {
    minHeight: 48,
    minWidth: 140,
    maxWidth: '45%',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#0B7B63',
  },
  subscriptionSubmitText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  subscriptionChoiceRow: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 12,
    backgroundColor: '#E9EDF0',
    marginBottom: 16,
  },
  subscriptionChoiceButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 9,
  },
  subscriptionChoiceButtonSelected: {
    backgroundColor: '#0B7B63',
  },
  subscriptionChoiceText: {
    color: '#374151',
    fontWeight: '700',
    fontSize: isSmallScreen ? 12 : 14,
  },
  subscriptionChoiceTextSelected: {
    color: '#fff',
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
  productQuantityControl: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0B7B63',
    borderRadius: 10,
    paddingHorizontal: 3,
  },
  productQuantityButton: {
    width: 26,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productQuantityButtonText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 18,
  },
  productQuantityValue: {
    width: 22,
    textAlign: 'center',
    color: '#fff',
    fontWeight: '800',
    fontSize: 12,
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
  discountValue: {
    color: '#0B7B63',
    fontSize: isSmallScreen ? 12 : 14,
    fontWeight: '700',
  },
  couponRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  couponInput: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 9,
    color: '#111827',
    backgroundColor: '#FFFFFF',
  },
  couponApplyButton: {
    minHeight: 42,
    paddingHorizontal: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: '#E4F4EE',
  },
  couponApplyText: {
    color: '#0B7B63',
    fontSize: 13,
    fontWeight: '800',
  },
  couponError: {
    color: '#B42318',
    fontSize: 12,
    marginBottom: 8,
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
  profileSignOut: {
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  profileSignOutText: {
    color: '#0B7B63',
    fontSize: 12,
    fontWeight: '700',
  },
  authIntro: {
    marginTop: -4,
    marginBottom: 14,
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 19,
  },
  authInput: {
    minHeight: 46,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    color: '#111827',
    fontSize: 14,
  },
  authError: {
    color: '#B42318',
    fontSize: 12,
    marginBottom: 8,
  },
  authModeButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  authModeText: {
    color: '#0B7B63',
    fontSize: 12,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.6,
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
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  addressSelectButton: {
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  addressRowActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 18,
    paddingTop: 8,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  addressActionText: {
    color: '#0B7B63',
    fontSize: 12,
    fontWeight: '700',
  },
  addressDeleteText: {
    color: '#B42318',
    fontSize: 12,
    fontWeight: '700',
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
  productDetailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
    justifyContent: 'center',
    padding: 16,
  },
  productDetailCard: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
  },
  productDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  productDetailCategory: {
    color: '#0B7B63',
    fontSize: isSmallScreen ? 12 : 13,
    fontWeight: '700',
  },
  productDetailCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  productDetailCloseText: {
    color: '#374151',
    fontSize: 22,
    lineHeight: 24,
  },
  productDetailImageWrap: {
    height: 150,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productDetailImage: {
    fontSize: 72,
  },
  productDetailName: {
    marginTop: 16,
    color: '#111827',
    fontSize: isSmallScreen ? 20 : 24,
    fontWeight: '800',
  },
  productDetailDescription: {
    marginTop: 8,
    color: '#6B7280',
    fontSize: isSmallScreen ? 13 : 14,
    lineHeight: 21,
  },
  productDetailRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  productDetailFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    marginTop: 18,
    paddingTop: 16,
  },
  productDetailPriceLabel: {
    color: '#6B7280',
    fontSize: 12,
    marginBottom: 2,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    maxHeight: '90%',
  },
  addressModalContent: {
    paddingTop: 20,
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalCloseButton: {
    fontSize: 24,
    color: '#6B7280',
    fontWeight: '700',
  },
  modalSubtitle: {
    fontSize: isSmallScreen ? 13 : 15,
    fontWeight: '700',
    color: '#111827',
    marginTop: 12,
    marginBottom: 12,
  },
  addressListWrap: {
    marginBottom: 12,
  },
  savedAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  savedAddressRowSelected: {
    backgroundColor: '#E8F7F3',
    borderColor: '#0B7B63',
  },
  addressIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#E9F2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  addressIcon: {
    fontSize: 22,
  },
  addressDetails: {
    flex: 1,
  },
  addressTypeTitle: {
    fontSize: isSmallScreen ? 13 : 14,
    fontWeight: '700',
    color: '#111827',
  },
  addressLineText: {
    fontSize: isSmallScreen ? 11 : 12,
    color: '#6B7280',
    marginTop: 4,
  },
  addressCheckmark: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: '#0B7B63',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  dividerLine: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 16,
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
  addressTextInput: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    minHeight: 48,
    marginBottom: 10,
    fontSize: isSmallScreen ? 12 : 14,
    color: '#111827',
  },
  placeSearchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  placeSearchInput: {
    flex: 1,
  },
  placesHelperText: {
    color: '#6B7280',
    fontSize: isSmallScreen ? 10 : 11,
    lineHeight: 16,
    marginBottom: 8,
  },
  placesErrorText: {
    color: '#B42318',
    fontSize: 12,
    marginBottom: 8,
  },
  placesSuggestions: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  placeSuggestion: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  placeSuggestionTitle: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
  },
  placeSuggestionSubtitle: {
    color: '#6B7280',
    fontSize: 11,
    marginTop: 3,
  },
  mapInstruction: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 8,
  },
  expandMapButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#E8F7F3',
    marginBottom: 8,
  },
  expandMapButtonText: {
    color: '#0B7B63',
    fontWeight: '800',
    fontSize: 12,
  },
  addressMapWrap: {
    height: 220,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 8,
  },
  addressMap: {
    flex: 1,
  },
  addressMapFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2F7',
    padding: 16,
  },
  googleMapFallbackContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  googleMapFallbackNotice: {
    backgroundColor: '#FFF4D6',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  googleMapFallbackText: {
    color: '#6B4D00',
    fontSize: 11,
    lineHeight: 15,
  },
  googleMapFallbackMap: {
    flex: 1,
  },
  fullscreenMapOverlay: {
    flex: 1,
    backgroundColor: '#fff',
  },
  fullscreenMapContent: {
    flex: 1,
    backgroundColor: '#fff',
  },
  fullscreenMapHeader: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  fullscreenMapBackButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
    marginRight: 12,
  },
  fullscreenMapBackText: {
    color: '#111827',
    fontSize: 30,
    lineHeight: 34,
  },
  fullscreenMapHeading: {
    flex: 1,
  },
  fullscreenMapTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '800',
  },
  fullscreenMapSubtitle: {
    color: '#6B7280',
    fontSize: 11,
    marginTop: 3,
  },
  fullscreenMapCanvas: {
    flex: 1,
  },
  fullscreenMapFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#fff',
  },
  fullscreenMapHint: {
    color: '#6B7280',
    fontSize: 12,
    marginBottom: 4,
  },
  fullscreenMapConfirmButton: {
    width: '100%',
  },
  useCurrentLocationButton: {
    alignSelf: 'flex-start',
    paddingVertical: 9,
    marginBottom: 8,
  },
  useCurrentLocationText: {
    color: '#0B7B63',
    fontSize: 13,
    fontWeight: '800',
  },
  selectedLocationText: {
    color: '#374151',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  addressSaveButton: {
    flex: 1,
    marginLeft: 8,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  paymentScreen: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  paymentContent: {
    paddingHorizontal: isSmallScreen ? 12 : 16,
    paddingTop: 16,
    paddingBottom: 28,
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
    alignItems: 'center',
    marginBottom: 8,
  },
  paymentPriceWrap: {
    alignItems: 'flex-end',
  },
  paymentOriginalPrice: {
    color: '#9CA3AF',
    fontSize: 10,
    textDecorationLine: 'line-through',
    marginBottom: 2,
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
  productCardImage: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  productPriceWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  productOriginalPrice: {
    color: '#9CA3AF',
    fontSize: 10,
    textDecorationLine: 'line-through',
  },
  cartItemImage: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  productDetailImageAsset: {
    width: 132,
    height: 132,
  },
  subscriptionProductImageAsset: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  subscriptionFooterImage: {
    width: 42,
    height: 42,
    borderRadius: 8,
    marginRight: 9,
  },
  adminPortalButton: {
    width: 'auto',
    minWidth: isSmallScreen ? 62 : 68,
    paddingHorizontal: 6,
    flexDirection: 'row',
    gap: 4,
  },
  adminPortalIcon: {
    color: '#374151',
    fontSize: 14,
  },
  adminPortalLabel: {
    color: '#374151',
    fontSize: 10,
    fontWeight: '700',
  },
});
