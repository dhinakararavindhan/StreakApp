// Fan-made franchise-season T20 squads, approximate ratings (0-100). Not official stats.
// P(name, minSlot, maxSlot, bat, pow, bwl, keeper?)
const P = (name, lo, hi, bat, pow, bwl, k = false) => ({ name, lo, hi, bat, pow, bwl, k })

const RAW = [
  { id: 'che10', name: 'Chennai', short: 'CHE', year: 2010, players: [
    P('Hayden', 1, 2, 80, 88, 0), P('M. Vijay', 1, 2, 60, 76, 0), P('Raina', 3, 4, 76, 90, 30),
    P('Badrinath', 3, 5, 66, 72, 0), P('Dhoni', 5, 6, 82, 92, 0, true), P('A. Morkel', 6, 7, 40, 88, 78),
    P('Bravo', 6, 7, 40, 86, 85), P('Ashwin', 8, 9, 20, 50, 86), P('Muralitharan', 9, 10, 8, 20, 92),
    P('Bollinger', 10, 11, 8, 22, 88), P('Balaji', 10, 11, 6, 20, 80)] },
  { id: 'che18', name: 'Chennai', short: 'CHE', year: 2018, players: [
    P('Watson', 1, 2, 74, 90, 66), P('du Plessis', 1, 3, 76, 82, 0), P('Rayudu', 3, 4, 72, 86, 0),
    P('Raina', 3, 4, 72, 88, 30), P('Dhoni', 5, 6, 84, 96, 0, true), P('Bravo', 6, 7, 40, 86, 86),
    P('Jadeja', 6, 7, 44, 76, 84), P('Harbhajan', 8, 9, 14, 50, 82), P('D. Chahar', 8, 9, 14, 40, 86),
    P('S. Thakur', 9, 10, 10, 40, 84), P('Tahir', 10, 11, 6, 20, 90)] },
  { id: 'mum13', name: 'Mumbai', short: 'MUM', year: 2013, players: [
    P('D. Smith', 1, 2, 60, 86, 0), P('Tendulkar', 1, 2, 74, 74, 0), P('Karthik', 3, 5, 64, 80, 0, true),
    P('Rohit', 3, 5, 66, 82, 20), P('Pollard', 4, 6, 62, 96, 60), P('Rayudu', 4, 5, 62, 78, 0),
    P('Harbhajan', 7, 8, 22, 56, 82), P('M. Johnson', 8, 9, 14, 50, 92), P('Malinga', 9, 10, 8, 30, 95),
    P('Ojha', 10, 11, 6, 16, 80), P('Munaf', 10, 11, 6, 16, 78)] },
  { id: 'mum20', name: 'Mumbai', short: 'MUM', year: 2020, players: [
    P('de Kock', 1, 2, 78, 90, 0, true), P('Rohit', 1, 2, 74, 90, 20), P('SKY', 3, 4, 76, 96, 0),
    P('I. Kishan', 3, 5, 62, 92, 0), P('Pollard', 4, 6, 66, 98, 55), P('Hardik', 5, 6, 58, 98, 60),
    P('Krunal', 6, 7, 44, 76, 78), P('Coulter-Nile', 8, 9, 14, 60, 88), P('R. Chahar', 8, 10, 8, 20, 82),
    P('Boult', 9, 11, 6, 20, 94), P('Bumrah', 10, 11, 8, 20, 98)] },
  { id: 'kol12', name: 'Kolkata', short: 'KOL', year: 2012, players: [
    P('Gambhir', 1, 2, 80, 78, 0), P('Bisla', 1, 2, 54, 86, 0), P('Kallis', 3, 4, 82, 76, 78),
    P('Tiwary', 3, 5, 62, 76, 0), P('Y. Pathan', 4, 5, 54, 96, 50), P('Shakib', 6, 7, 44, 70, 82),
    P('Haddin', 5, 7, 50, 76, 0, true), P('Bhatia', 7, 8, 30, 60, 70), P('Narine', 8, 9, 20, 68, 95),
    P('B. Lee', 9, 10, 8, 30, 90), P('M. Morkel', 10, 11, 8, 26, 88)] },
  { id: 'blr16', name: 'Bengaluru', short: 'BLR', year: 2016, players: [
    P('Gayle', 1, 2, 80, 98, 20), P('Kohli', 1, 3, 92, 92, 0), P('de Villiers', 3, 4, 84, 100, 5),
    P('KL Rahul', 2, 4, 68, 86, 0), P('Watson', 4, 6, 60, 86, 70), P('Sarfaraz', 5, 6, 40, 80, 0),
    P('Binny', 6, 7, 36, 76, 60), P('Vishnu Vinod', 6, 7, 30, 70, 0, true), P('Chahal', 8, 9, 6, 20, 88),
    P('Mills', 9, 10, 6, 20, 84), P('Milne', 10, 11, 6, 20, 84)] },
  { id: 'hyd16', name: 'Hyderabad', short: 'HYD', year: 2016, players: [
    P('Warner', 1, 2, 88, 90, 0), P('Dhawan', 1, 2, 80, 78, 0), P('Yuvraj', 3, 5, 60, 86, 40),
    P('Henriques', 3, 5, 56, 76, 56), P('Hooda', 5, 6, 42, 80, 30), P('N. Ojha', 5, 6, 52, 76, 0, true),
    P('Cutting', 6, 7, 38, 98, 80), P('Bipul Sharma', 6, 8, 30, 66, 60), P('Bhuvneshwar', 8, 9, 24, 50, 94),
    P('Mustafizur', 9, 10, 6, 16, 90), P('B. Sran', 10, 11, 6, 16, 80)] },
  { id: 'jai08', name: 'Jaipur', short: 'JAI', year: 2008, players: [
    P('G. Smith', 1, 2, 64, 70, 0), P('Watson', 1, 3, 78, 92, 86), P('K. Akmal', 1, 3, 56, 84, 0, true),
    P('Y. Pathan', 3, 5, 64, 96, 50), P('Kaif', 3, 4, 62, 66, 0), P('Jadeja', 5, 6, 36, 70, 70),
    P('Mascarenhas', 6, 8, 30, 70, 78), P('Warne', 8, 9, 14, 40, 88), P('S. Tanvir', 8, 9, 12, 40, 90),
    P('Munaf', 10, 11, 6, 16, 82), P('Trivedi', 10, 11, 6, 16, 78)] },
  { id: 'amd22', name: 'Ahmedabad', short: 'AMD', year: 2022, players: [
    P('Saha', 1, 2, 66, 84, 0, true), P('Gill', 1, 2, 76, 82, 0), P('Sudharsan', 3, 4, 64, 80, 0),
    P('Hardik', 3, 5, 64, 86, 76), P('Miller', 4, 5, 66, 94, 0), P('Tewatia', 5, 6, 40, 92, 40),
    P('Rashid', 7, 8, 30, 84, 95), P('Shami', 9, 10, 8, 24, 92), P('Ferguson', 9, 10, 6, 20, 92),
    P('Y. Dayal', 10, 11, 6, 14, 80), P('A. Joseph', 10, 11, 6, 20, 86)] },
  { id: 'pun14', name: 'Punjab', short: 'PUN', year: 2014, players: [
    P('Sehwag', 1, 2, 62, 92, 10), P('Vohra', 1, 2, 60, 86, 0), P('Saha', 2, 3, 60, 84, 0, true),
    P('Maxwell', 3, 5, 66, 100, 60), P('Miller', 4, 5, 62, 96, 0), P('Bailey', 3, 4, 62, 80, 0),
    P('Axar', 6, 8, 30, 70, 84), P('Chawla', 8, 9, 18, 50, 80), P('M. Johnson', 9, 10, 14, 50, 90),
    P('Sandeep Sharma', 10, 11, 6, 16, 84), P('K. Singh', 10, 11, 6, 16, 72)] },
  { id: 'del20', name: 'Delhi', short: 'DEL', year: 2020, players: [
    P('Dhawan', 1, 2, 80, 82, 0), P('P. Shaw', 1, 2, 60, 92, 0), P('S. Iyer', 3, 4, 68, 84, 0),
    P('Pant', 3, 5, 64, 90, 0, true), P('Stoinis', 4, 6, 54, 88, 60), P('Hetmyer', 5, 6, 44, 92, 0),
    P('Axar', 6, 7, 30, 74, 86), P('Ashwin', 8, 9, 20, 50, 84), P('Rabada', 9, 10, 8, 30, 95),
    P('Nortje', 10, 11, 6, 20, 94), P('Ishant', 10, 11, 6, 16, 80)] },
  { id: 'che11', name: 'Chennai', short: 'CHE', year: 2011, players: [
    P('Hussey', 1, 2, 80, 84, 0), P('M. Vijay', 1, 2, 62, 78, 0), P('Raina', 3, 4, 76, 90, 30),
    P('Badrinath', 3, 4, 66, 72, 0), P('Dhoni', 5, 6, 82, 92, 0, true), P('Bravo', 6, 7, 40, 86, 85),
    P('A. Morkel', 6, 7, 40, 88, 78), P('Ashwin', 7, 8, 22, 52, 86), P('Muralitharan', 9, 10, 8, 20, 92),
    P('Bollinger', 9, 10, 8, 22, 88), P('Balaji', 10, 11, 6, 20, 80)] },
  { id: 'che21', name: 'Chennai', short: 'CHE', year: 2021, players: [
    P('Gaikwad', 1, 2, 74, 86, 0), P('du Plessis', 1, 2, 78, 88, 0), P('Moeen Ali', 3, 4, 52, 88, 60),
    P('Uthappa', 3, 4, 62, 86, 0), P('Raina', 3, 5, 68, 84, 30), P('Dhoni', 5, 6, 80, 90, 0, true),
    P('Jadeja', 6, 7, 46, 80, 86), P('Bravo', 7, 8, 40, 84, 84), P('S. Thakur', 8, 9, 10, 40, 84),
    P('D. Chahar', 9, 10, 14, 40, 88), P('Hazlewood', 10, 11, 6, 16, 92)] },
  { id: 'mum15', name: 'Mumbai', short: 'MUM', year: 2015, players: [
    P('Rohit', 1, 2, 72, 86, 20), P('Simmons', 1, 2, 66, 82, 0), P('Parthiv Patel', 1, 3, 56, 78, 0, true),
    P('Buttler', 3, 5, 64, 92, 0), P('Rayudu', 3, 4, 64, 80, 0), P('Pollard', 4, 6, 62, 96, 60),
    P('Hardik', 5, 6, 50, 92, 60), P('Harbhajan', 7, 8, 22, 56, 82), P('McClenaghan', 8, 9, 8, 20, 88),
    P('Malinga', 9, 10, 8, 30, 95), P('Ojha', 10, 11, 6, 16, 80)] },
  { id: 'kol14', name: 'Kolkata', short: 'KOL', year: 2014, players: [
    P('Gambhir', 1, 2, 80, 78, 0), P('Uthappa', 1, 3, 64, 86, 0, true), P('M. Pandey', 3, 4, 62, 82, 0),
    P('Kallis', 3, 4, 82, 76, 78), P('Y. Pathan', 4, 5, 54, 96, 50), P('Russell', 5, 6, 54, 98, 86),
    P('Shakib', 6, 7, 44, 70, 82), P('Narine', 7, 8, 20, 70, 95), P('Chawla', 8, 9, 18, 50, 80),
    P('M. Morkel', 9, 10, 8, 26, 88), P('U. Yadav', 10, 11, 8, 24, 88)] },
  { id: 'hyd24', name: 'Hyderabad', short: 'HYD', year: 2024, players: [
    P('T. Head', 1, 2, 82, 100, 20), P('Abhishek', 1, 2, 58, 98, 30), P('Klaasen', 3, 5, 72, 100, 0, true),
    P('Markram', 3, 4, 70, 84, 40), P('N. Reddy', 4, 6, 52, 88, 60), P('Abdul Samad', 5, 7, 40, 92, 0),
    P('Shahbaz', 6, 7, 30, 76, 70), P('Cummins', 8, 9, 30, 60, 88), P('Bhuvneshwar', 8, 9, 24, 50, 94),
    P('Natarajan', 10, 11, 6, 16, 90), P('Unadkat', 10, 11, 6, 16, 82)] },
  { id: 'blr24', name: 'Bengaluru', short: 'BLR', year: 2024, players: [
    P('Kohli', 1, 3, 90, 90, 0), P('du Plessis', 1, 2, 70, 90, 0), P('W. Jacks', 3, 4, 62, 96, 40),
    P('Patidar', 3, 4, 64, 92, 0), P('Maxwell', 4, 5, 54, 100, 60), P('D. Karthik', 5, 6, 62, 98, 0, true),
    P('Lomror', 6, 7, 30, 84, 40), P('Siraj', 8, 9, 8, 20, 90), P('Y. Dayal', 9, 10, 6, 14, 80),
    P('Ferguson', 10, 11, 6, 20, 92), P('Karn Sharma', 10, 11, 6, 16, 76)] },
  { id: 'lko23', name: 'Lucknow', short: 'LKO', year: 2023, players: [
    P('KL Rahul', 1, 2, 80, 84, 0), P('Mayers', 1, 2, 60, 92, 40), P('de Kock', 1, 2, 76, 90, 0, true),
    P('Pooran', 3, 5, 62, 98, 0), P('Stoinis', 4, 6, 54, 88, 60), P('Krunal', 6, 7, 44, 76, 78),
    P('Badoni', 5, 6, 46, 84, 0), P('Avesh Khan', 8, 9, 8, 20, 84), P('Bishnoi', 8, 9, 8, 20, 86),
    P('M. Wood', 9, 10, 8, 24, 92), P('Naveen-ul-Haq', 10, 11, 6, 16, 86)] },
  { id: 'jai22', name: 'Jaipur', short: 'JAI', year: 2022, players: [
    P('Buttler', 1, 2, 84, 96, 0), P('Jaiswal', 1, 2, 68, 92, 0), P('Samson', 3, 4, 68, 92, 0, true),
    P('Padikkal', 3, 4, 60, 82, 0), P('Hetmyer', 5, 6, 44, 92, 0), P('R. Parag', 5, 6, 48, 86, 30),
    P('Ashwin', 7, 8, 22, 52, 86), P('Boult', 8, 9, 6, 20, 94), P('Chahal', 9, 10, 6, 20, 88),
    P('P. Krishna', 10, 11, 6, 16, 88), P('McCoy', 10, 11, 6, 16, 84)] },
  { id: 'syd20', name: 'Sydney', short: 'SYD', year: 2020, players: [
    P('Philippe', 1, 2, 64, 90, 0, true), P('Vince', 1, 2, 74, 86, 0), P('S. Smith', 3, 4, 74, 78, 10),
    P('Henriques', 3, 5, 58, 80, 50), P('J. Silk', 4, 5, 50, 76, 0), P('J. Edwards', 5, 6, 40, 80, 40),
    P('S. Abbott', 7, 8, 20, 68, 88), P('Dwarshuis', 8, 9, 10, 30, 84), P('O\'Keefe', 9, 10, 8, 20, 86),
    P('L. Pope', 10, 11, 6, 16, 80), P('J. Bird', 10, 11, 6, 16, 84)] },
  { id: 'per13', name: 'Perth', short: 'PER', year: 2013, players: [
    P('Klinger', 1, 2, 76, 76, 0), P('Ronchi', 1, 3, 56, 92, 0, true), P('S. Marsh', 3, 4, 80, 80, 0),
    P('North', 3, 5, 60, 66, 40), P('Voges', 4, 5, 60, 70, 0), P('M. Marsh', 5, 6, 50, 84, 70),
    P('Agar', 7, 8, 22, 58, 82), P('Coulter-Nile', 8, 9, 14, 60, 88), P('M. Johnson', 9, 10, 14, 50, 90),
    P('Hogg', 9, 10, 10, 30, 82), P('Beer', 10, 11, 6, 16, 70)] },
  { id: 'lah22', name: 'Lahore', short: 'LAH', year: 2022, players: [
    P('Fakhar Zaman', 1, 2, 68, 92, 0), P('A. Shafique', 1, 2, 56, 76, 0), P('Hafeez', 3, 4, 62, 80, 56),
    P('Billings', 3, 5, 56, 84, 0, true), P('Brook', 3, 5, 62, 92, 0), P('Wiese', 5, 7, 38, 92, 72),
    P('S. Patel', 5, 6, 46, 76, 70), P('Rashid', 7, 8, 30, 84, 96), P('Shaheen', 9, 10, 8, 30, 96),
    P('Rauf', 9, 10, 6, 16, 90), P('D. Hussain', 10, 11, 6, 16, 76)] },
  { id: 'tri18', name: 'Trinidad', short: 'TRI', year: 2018, players: [
    P('Simmons', 1, 2, 62, 80, 0), P('Munro', 1, 2, 68, 96, 0), P('McCullum', 1, 3, 58, 94, 0),
    P('Ramdin', 3, 5, 40, 70, 0, true), P('Darren Bravo', 3, 4, 60, 76, 0), P('Pollard', 4, 6, 62, 96, 60),
    P('Bravo', 6, 7, 40, 86, 85), P('Narine', 7, 8, 20, 70, 95), P('Ali Khan', 9, 10, 6, 16, 82),
    P('K. Pierre', 9, 10, 6, 16, 80), P('Emrit', 10, 11, 6, 16, 78)] },
]
// Unique id per player-in-squad (same real player can appear in several seasons).
export const SQUADS = RAW.map((s) => ({ ...s, players: s.players.map((p) => ({ ...p, id: `${s.id}:${p.name}`, team: s.short, year: s.year })) }))

export const SLOT_LABELS = ['Opener', 'Opener', 'No. 3', 'No. 4', 'No. 5', 'No. 6', 'No. 7', 'No. 8', 'No. 9', 'No. 10', 'No. 11']
export const TARGET = 300
export const BALLS = 120 // 20 overs
