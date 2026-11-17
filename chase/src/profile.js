// Shared by the app and the server: allowed values for the optional profile and for analytics events.
export const AGE_BANDS = [['u18', 'Under 18'], ['18-24', '18–24'], ['25-34', '25–34'], ['35-44', '35–44'], ['45+', '45 and over']]
export const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Chandigarh', 'Puducherry', 'Other Indian UT', 'Outside India',
]
export const TEAM_CITIES = ['Chennai', 'Mumbai', 'Kolkata', 'Bengaluru', 'Hyderabad', 'Jaipur', 'Ahmedabad', 'Punjab', 'Delhi', 'Lucknow',
  'Sydney', 'Perth', 'Hobart', 'Melbourne', 'Adelaide', 'Brisbane', 'Trinidad', 'Jamaica', 'Gqeberha', 'Paarl', 'Johannesburg', 'Pretoria',
  'Karachi', 'Islamabad', 'Multan', 'Quetta', 'Peshawar', 'Lahore', 'London', 'Nottingham', 'No favourite']
// analytics: only these event names are accepted
export const EVENT_NAMES = ['session_start', 'game_start', 'game_finish', 'draft_abandon', 'level_cleared', 'share', 'install', 'push_on', 'push_off',
  'vs_create', 'vs_join', 'howto_open', 'profile_saved', 'theme_toggle']
