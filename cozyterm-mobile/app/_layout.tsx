import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../src/theme/colors';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          tabBarStyle: {
            backgroundColor: colors.bg,
            borderTopColor: colors.bgLighter,
            borderTopWidth: 1,
          },
          tabBarActiveTintColor: colors.cyan,
          tabBarInactiveTintColor: colors.grayDim,
          headerStyle: {
            backgroundColor: colors.bg,
            shadowColor: 'transparent',
            borderBottomWidth: 1,
            borderBottomColor: colors.bgLighter,
          },
          headerTintColor: colors.white,
          headerTitleStyle: {
            fontWeight: '600',
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Engie',
            tabBarLabel: 'Chat',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="chatbubble-ellipses-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="memory"
          options={{
            title: 'Memory',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="bulb-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="status"
          options={{
            title: 'Status',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="pulse-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings-outline" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </>
  );
}
