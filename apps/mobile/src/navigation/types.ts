export type RootStackParamList = {
  Login: undefined;
  Onboarding: undefined;
  Dashboard: undefined;
  Map: undefined;
  NewListing: undefined;
  PaymentPending: { orderId: string };
  Conversations: undefined;
  Conversation: { conversationId: string; counterpartName: string };
};
