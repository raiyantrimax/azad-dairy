import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Alert,
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
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

type TabName = 'Home' | 'Cart' | 'Profile';
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
  houseDetails?: string;
  landmark?: string;
  latitude?: number;
  longitude?: number;
  isDefault?: boolean;
};

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

const subscriptionSlots = ['Daily', 'Alternate Days', 'Mon–Sat', 'Sun Only'];
const subscriptionDeliveriesPerWeek: Record<string, number> = {
  Daily: 7,
  'Alternate Days': 3.5,
  'Mon–Sat': 6,
  'Sun Only': 1,
};
const deliveryTimings = ['6:00 AM', '8:00 AM', '10:00 AM', '6:30 PM'];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabName>('Home');
  const [selectedCategory, setSelectedCategory] = useState<CategoryName>('All');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>([
    { ...products[0], quantity: 2 },
    { ...products[4], quantity: 1 },
  ]);
  const [showPayment, setShowPayment] = useState(false);
  const [addresses, setAddresses] = useState<Address[]>(defaultAddresses);
  const [selectedAddressId, setSelectedAddressId] = useState<number>(1);
  const [locationModalVisible, setLocationModalVisible] = useState(false);
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
  const [subscription, setSubscription] = useState('Daily');
  const [subscriptionEnabled, setSubscriptionEnabled] = useState(false);
  const [deliveryTime, setDeliveryTime] = useState('6:00 AM');
  const [userLocation, setUserLocation] = useState<string | null>(null);
  const [userCoordinates, setUserCoordinates] = useState<Coordinates | null>(null);
  const addressScrollRef = useRef<ScrollView>(null);

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
    if (selectedCategory === 'All') return products;
    return products.filter((item) => item.category === selectedCategory);
  }, [selectedCategory]);

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const deliveryCharge = subtotal > 0 ? 29 : 0;
  const total = subtotal + deliveryCharge;
  const deliveriesPerWeek = subscriptionDeliveriesPerWeek[subscription];
  const weeklySubscriptionTotal = Math.round(total * deliveriesPerWeek);
  const subscriptionFrequencyLabel = subscription === 'Alternate Days'
    ? '3-4 deliveries / week'
    : `${deliveriesPerWeek} deliveries / week`;
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

  const openAddressPicker = () => {
    setIsMapExpanded(false);
    setGoogleMapReady(false);
    setGoogleMapFailed(false);
    setNewHouseDetails('');
    setNewLandmark('');
    setPlaceSearch('');
    setPlaceSuggestions([]);
    setPlacesError(null);
    setSelectedCoordinates(userCoordinates);
    setSelectedPlaceLabel(userLocation ?? '');
    setMapRegion({
      ...defaultMapRegion,
      ...(userCoordinates ?? {}),
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

  const renderAddressMap = () => (
    Platform.OS === 'web' ? (
      <View style={[styles.addressMap, styles.addressMapFallback]}>
        <Text style={styles.placesHelperText}>Map pin selection is available in the mobile app.</Text>
      </View>
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
    const nextAddress: Address = {
      id: Date.now(),
      label: newAddressType,
      area: geocodedAddress?.area ?? 'Selected location',
      line: selectedPlaceLabel && selectedPlaceLabel !== 'Resolving selected location...'
        ? selectedPlaceLabel
        : geocodedAddress?.line || `${selectedCoordinates.latitude.toFixed(5)}, ${selectedCoordinates.longitude.toFixed(5)}`,
      houseDetails: newHouseDetails.trim(),
      landmark: newLandmark.trim() || undefined,
      latitude: selectedCoordinates.latitude,
      longitude: selectedCoordinates.longitude,
    };

    setAddresses((current) => [...current, nextAddress]);
    setSelectedAddressId(nextAddress.id);
    setNewHouseDetails('');
    setNewLandmark('');
    setLocationModalVisible(false);
    Alert.alert('Address saved', `${newAddressType} address saved successfully.`);
  };

  const renderHeader = () => (
    <View style={styles.headerWrap}>
      <View style={styles.headerTop}>
        <View>
          <Text style={styles.headerLabel}>Deliver to</Text>
          <TouchableOpacity onPress={openAddressPicker}>
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

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>{selectedCategory === 'All' ? 'All products' : selectedCategory}</Text>
        <Text style={styles.resultCount}>{visibleProducts.length} items</Text>
      </View>

      <View style={styles.productGrid}>
        {visibleProducts.map((product) => (
          <View key={product.id} style={styles.productCard}>
            <TouchableOpacity activeOpacity={0.85} onPress={() => setSelectedProduct(product)}>
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
            </TouchableOpacity>

            <View style={styles.productFooterRow}>
              <Text style={styles.productPrice}>₹{product.price}</Text>
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
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.profileScrollContent}
      showsVerticalScrollIndicator={false}
    >
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
              <Text style={styles.addressLine}>{formatAddress(address)}</Text>
            </View>
            {address.isDefault && <Text style={styles.defaultTag}>Default</Text>}
          </Pressable>
        ))}

        <TouchableOpacity onPress={openAddressPicker} style={styles.secondaryButtonSmall}>
          <Text style={styles.secondaryButtonText}>Add new address</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.cardTitle}>Subscription</Text>
        {subscriptionEnabled ? (
          <>
            <Text style={styles.subscriptionInfo}>Plan: {subscription}</Text>
            <Text style={styles.subscriptionInfo}>Delivery time: {deliveryTime}</Text>
          </>
        ) : (
          <Text style={styles.subscriptionInfo}>No active subscription</Text>
        )}
      </View>
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
              style={[styles.subscriptionChoiceButton, !subscriptionEnabled && styles.subscriptionChoiceButtonSelected]}
              onPress={() => setSubscriptionEnabled(false)}
            >
              <Text style={[styles.subscriptionChoiceText, !subscriptionEnabled && styles.subscriptionChoiceTextSelected]}>
                One-time
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.subscriptionChoiceButton, subscriptionEnabled && styles.subscriptionChoiceButtonSelected]}
              onPress={() => setSubscriptionEnabled(true)}
            >
              <Text style={[styles.subscriptionChoiceText, subscriptionEnabled && styles.subscriptionChoiceTextSelected]}>
                Subscribe
              </Text>
            </TouchableOpacity>
          </View>

          {subscriptionEnabled && (
            <>
              <Text style={styles.timeLabel}>Delivery schedule</Text>
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
            </>
          )}
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.cardTitle}>Order summary</Text>
          {cart.map((item) => (
            <View key={item.id} style={styles.paymentItemRow}>
              <Text style={styles.paymentItemText}>{item.name} x{item.quantity}</Text>
              <Text style={styles.paymentItemText}>₹{item.price * item.quantity}</Text>
            </View>
          ))}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{subscriptionEnabled ? 'Subtotal per delivery' : 'Subtotal'}</Text>
            <Text style={styles.summaryValue}>₹{subtotal}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{subscriptionEnabled ? 'Delivery per delivery' : 'Delivery'}</Text>
            <Text style={styles.summaryValue}>₹{deliveryCharge}</Text>
          </View>
          {subscriptionEnabled ? (
            <>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Frequency</Text>
                <Text style={styles.summaryValue}>{subscriptionFrequencyLabel}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabelStrong}>Estimated weekly total</Text>
                <Text style={styles.summaryValueStrong}>₹{weeklySubscriptionTotal}</Text>
              </View>
            </>
          ) : (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabelStrong}>Total</Text>
              <Text style={styles.summaryValueStrong}>₹{total}</Text>
            </View>
          )}
        </View>

        <View style={styles.paymentNotice}>
          <Text style={styles.paymentNoticeTitle}>Payment gateway</Text>
          <Text style={styles.paymentNoticeText}>Integration will be added later. For now this is a frontend-only checkout flow.</Text>
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => Alert.alert(
            'Order placed',
            subscriptionEnabled
              ? `Your ${subscription} subscription is set for ${deliveryTime}. Estimated weekly total: ₹${weeklySubscriptionTotal}.`
              : 'Your order has been placed successfully.'
          )}
        >
          <Text style={styles.primaryButtonText}>Place order</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );

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
                <TouchableOpacity key={tab} style={styles.tabItem} onPress={() => setActiveTab(tab)}>
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
                  <Text style={styles.productDetailImage}>{selectedProduct.image}</Text>
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
                  </View>
                  {renderProductQuantityControl(selectedProduct)}
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
