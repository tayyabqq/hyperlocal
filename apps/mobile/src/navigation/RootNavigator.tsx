import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { useAuth } from '../context/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { MapScreen } from '../screens/MapScreen';
import { NewListingScreen } from '../screens/NewListingScreen';
import { PaymentPendingScreen } from '../screens/PaymentPendingScreen';
import { ConversationsScreen } from '../screens/ConversationsScreen';
import { ConversationScreen } from '../screens/ConversationScreen';
import { colors } from '../components/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  // A restored session whose profile was never finished must land on
  // Onboarding, not the dashboard.
  const initialRoute: keyof RootStackParamList =
    status === 'authenticated' ? (user && !user.isProfileComplete ? 'Onboarding' : 'Dashboard') : 'Login';

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="Map" component={MapScreen} />
        <Stack.Screen name="NewListing" component={NewListingScreen} />
        <Stack.Screen name="PaymentPending" component={PaymentPendingScreen} />
        <Stack.Screen name="Conversations" component={ConversationsScreen} />
        <Stack.Screen name="Conversation" component={ConversationScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
});
