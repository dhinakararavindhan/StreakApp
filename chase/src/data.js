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
  { id: 'mum17', name: 'Mumbai', short: 'MUM', year: 2017, players: [
    P('Parthiv Patel', 1, 2, 56, 80, 0, true), P('Simmons', 1, 2, 66, 82, 0), P('N. Rana', 3, 4, 58, 84, 0),
    P('Rohit', 3, 4, 72, 88, 20), P('Pollard', 4, 6, 62, 96, 60), P('Hardik', 5, 6, 54, 94, 64),
    P('Krunal', 6, 7, 44, 78, 78), P('Harbhajan', 7, 8, 22, 54, 80), P('McClenaghan', 8, 9, 8, 20, 88),
    P('Malinga', 9, 10, 8, 30, 94), P('Bumrah', 10, 11, 8, 20, 96)] },
  { id: 'mum19', name: 'Mumbai', short: 'MUM', year: 2019, players: [
    P('de Kock', 1, 2, 74, 90, 0, true), P('Rohit', 1, 2, 72, 90, 20), P('SKY', 3, 4, 72, 94, 0),
    P('I. Kishan', 3, 5, 58, 90, 0), P('Pollard', 4, 6, 64, 98, 55), P('Hardik', 5, 6, 56, 98, 62),
    P('Krunal', 6, 7, 44, 78, 80), P('R. Chahar', 8, 9, 8, 20, 84), P('Markande', 8, 10, 6, 14, 78),
    P('Malinga', 9, 10, 8, 30, 94), P('Bumrah', 10, 11, 8, 20, 98)] },
  { id: 'kol24', name: 'Kolkata', short: 'KOL', year: 2024, players: [
    P('Salt', 1, 2, 72, 96, 0, true), P('Narine', 1, 2, 50, 96, 92), P('V. Iyer', 3, 4, 60, 88, 30),
    P('S. Iyer', 3, 4, 68, 86, 0), P('Rinku Singh', 5, 6, 56, 92, 0), P('Russell', 5, 6, 54, 98, 86),
    P('Ramandeep', 6, 7, 36, 84, 50), P('Starc', 8, 9, 10, 30, 92), P('H. Rana', 9, 10, 6, 14, 84),
    P('Varun C.', 10, 11, 6, 14, 88), P('V. Arora', 10, 11, 6, 14, 82)] },
  { id: 'amd23', name: 'Ahmedabad', short: 'AMD', year: 2023, players: [
    P('Saha', 1, 2, 66, 84, 0, true), P('Gill', 1, 2, 82, 92, 0), P('Sudharsan', 3, 4, 64, 82, 0),
    P('Hardik', 3, 5, 64, 88, 78), P('Miller', 4, 5, 66, 94, 0), P('V. Shankar', 4, 6, 46, 82, 40),
    P('Tewatia', 5, 6, 40, 92, 40), P('Rashid', 7, 8, 30, 86, 96), P('Shami', 9, 10, 8, 24, 94),
    P('Mohit Sharma', 9, 10, 6, 14, 88), P('Noor Ahmad', 10, 11, 6, 14, 84)] },
  { id: 'del12', name: 'Delhi', short: 'DEL', year: 2012, players: [
    P('Warner', 1, 2, 80, 92, 0), P('Sehwag', 1, 2, 60, 90, 10), P('Jayawardene', 3, 4, 78, 76, 0),
    P('N. Ojha', 3, 5, 52, 78, 0, true), P('Venugopal Rao', 4, 5, 56, 80, 0), P('I. Pathan', 6, 7, 40, 72, 82),
    P('Russell', 6, 7, 50, 96, 82), P('M. Morkel', 8, 9, 8, 26, 90), P('Umesh Yadav', 9, 10, 8, 24, 88),
    P('Nehra', 10, 11, 6, 14, 84), P('V. Aaron', 10, 11, 6, 14, 80)] },
  { id: 'jai24', name: 'Jaipur', short: 'JAI', year: 2024, players: [
    P('Jaiswal', 1, 2, 74, 94, 0), P('Buttler', 1, 2, 82, 94, 0), P('Samson', 3, 4, 72, 94, 0, true),
    P('R. Parag', 3, 5, 62, 94, 30), P('D. Jurel', 5, 6, 46, 86, 0, true), P('Hetmyer', 5, 6, 44, 92, 0),
    P('Ashwin', 7, 8, 22, 52, 86), P('Boult', 8, 9, 6, 20, 94), P('Chahal', 9, 10, 6, 20, 90),
    P('Avesh Khan', 9, 10, 8, 20, 86), P('Sandeep Sharma', 10, 11, 6, 16, 86)] },
  { id: 'che23', name: 'Chennai', short: 'CHE', year: 2023, players: [
    P('Conway', 1, 2, 80, 92, 0), P('Gaikwad', 1, 2, 70, 88, 0), P('Rahane', 3, 4, 62, 90, 0),
    P('Rayudu', 3, 5, 62, 84, 0), P('S. Dube', 4, 5, 52, 94, 30), P('Moeen Ali', 4, 6, 52, 88, 60),
    P('Jadeja', 6, 7, 46, 80, 86), P('Dhoni', 6, 7, 78, 96, 0, true), P('Theekshana', 8, 9, 8, 20, 88),
    P('Pathirana', 9, 10, 6, 14, 90), P('Deshpande', 10, 11, 6, 14, 82)] },
  { id: 'hyd18', name: 'Hyderabad', short: 'HYD', year: 2018, players: [
    P('Dhawan', 1, 2, 80, 80, 0), P('Saha', 1, 2, 64, 82, 0, true), P('Williamson', 3, 3, 86, 84, 10),
    P('M. Pandey', 4, 5, 62, 82, 0), P('Shakib', 5, 6, 46, 76, 82), P('Y. Pathan', 5, 6, 50, 90, 40),
    P('Rashid', 7, 8, 26, 80, 95), P('Bhuvneshwar', 8, 9, 24, 50, 94), P('S. Kaul', 9, 10, 6, 14, 84),
    P('Sandeep Sharma', 9, 11, 6, 16, 86), P('B. Thampi', 10, 11, 6, 14, 80)] },
  { id: 'lko22', name: 'Lucknow', short: 'LKO', year: 2022, players: [
    P('KL Rahul', 1, 2, 82, 86, 0), P('de Kock', 1, 2, 76, 90, 0, true), P('D. Hooda', 3, 4, 52, 86, 30),
    P('Stoinis', 3, 5, 54, 88, 60), P('Badoni', 4, 6, 46, 84, 0), P('Krunal', 5, 7, 44, 78, 78),
    P('J. Holder', 6, 7, 36, 78, 86), P('Avesh Khan', 8, 9, 8, 20, 86), P('Mohsin Khan', 9, 10, 6, 14, 86),
    P('Bishnoi', 8, 9, 8, 20, 86), P('Chameera', 10, 11, 6, 14, 84)] },
  { id: 'pun21', name: 'Punjab', short: 'PUN', year: 2021, players: [
    P('KL Rahul', 1, 2, 84, 88, 0, true), P('M. Agarwal', 1, 2, 66, 90, 0), P('Gayle', 2, 3, 70, 94, 20),
    P('Pooran', 3, 5, 60, 92, 0), P('Markram', 3, 5, 66, 84, 40), P('D. Hooda', 4, 6, 52, 86, 30),
    P('Shahrukh Khan', 5, 6, 36, 90, 0), P('H. Brar', 7, 8, 14, 50, 76), P('Shami', 8, 9, 8, 24, 94),
    P('Arshdeep', 9, 10, 6, 14, 88), P('Bishnoi', 10, 11, 8, 20, 86)] },
  { id: 'ade18', name: 'Adelaide', short: 'ADE', year: 2018, players: [
    P('Weatherald', 1, 2, 62, 86, 0), P('Carey', 1, 3, 70, 86, 0, true), P('C. Ingram', 3, 4, 70, 84, 0),
    P('J. Wells', 3, 5, 54, 78, 0), P('Short', 4, 6, 60, 88, 50), P('Rashid', 7, 8, 30, 86, 96),
    P('Neser', 7, 8, 24, 70, 78), P('Laughlin', 8, 9, 8, 24, 82), P('Stanlake', 10, 11, 6, 14, 88),
    P('Zampa', 9, 10, 6, 16, 90), P('Gurinder Sandhu', 10, 11, 6, 14, 76)] },
  { id: 'bri18', name: 'Brisbane', short: 'BRI', year: 2018, players: [
    P('C. Lynn', 1, 2, 68, 98, 0), P('McCullum', 1, 3, 58, 94, 0), P('Peirson', 3, 5, 50, 76, 0, true),
    P('A. Ross', 4, 5, 56, 80, 0), P('Burns', 3, 4, 56, 78, 0), P('Cutting', 6, 7, 38, 98, 82),
    P('Heazlett', 5, 6, 40, 78, 40), P('Mujeeb', 8, 9, 10, 20, 90), P('Steketee', 9, 10, 6, 14, 82),
    P('Doggett', 10, 11, 6, 14, 78), P('M. Swepson', 10, 11, 6, 16, 84)] },
  // ---- more IPL seasons ----
  { id: 'che19', name: 'Chennai', short: 'CHE', year: 2019, players: [
    P('Watson', 1, 2, 72, 88, 66), P('du Plessis', 1, 2, 76, 84, 0), P('Raina', 3, 4, 70, 86, 30),
    P('Rayudu', 3, 4, 62, 84, 0), P('K. Jadhav', 5, 6, 50, 80, 20), P('Dhoni', 5, 6, 84, 98, 0, true),
    P('Jadeja', 6, 7, 44, 78, 86), P('Bravo', 7, 8, 40, 84, 84), P('D. Chahar', 8, 9, 14, 40, 88),
    P('Tahir', 9, 10, 6, 20, 94), P('Harbhajan', 10, 11, 14, 50, 80)] },
  { id: 'mum21', name: 'Mumbai', short: 'MUM', year: 2021, players: [
    P('Rohit', 1, 2, 72, 88, 20), P('de Kock', 1, 2, 74, 88, 0, true), P('SKY', 3, 4, 74, 96, 0),
    P('I. Kishan', 3, 5, 60, 92, 0), P('Pollard', 4, 6, 62, 96, 55), P('Hardik', 5, 6, 56, 94, 58),
    P('Krunal', 6, 7, 44, 76, 78), P('Coulter-Nile', 7, 8, 14, 60, 88), P('R. Chahar', 8, 9, 8, 20, 84),
    P('Boult', 9, 10, 6, 20, 94), P('Bumrah', 10, 11, 8, 20, 98)] },
  { id: 'blr21', name: 'Bengaluru', short: 'BLR', year: 2021, players: [
    P('Kohli', 1, 2, 90, 88, 0), P('Padikkal', 1, 2, 62, 86, 0), P('Maxwell', 3, 4, 58, 100, 60),
    P('de Villiers', 3, 5, 84, 100, 5), P('S. Bharat', 4, 5, 48, 80, 0, true), P('D. Christian', 5, 6, 40, 90, 70),
    P('W. Sundar', 6, 7, 34, 70, 78), P('Jamieson', 7, 8, 30, 70, 86), P('Harshal', 8, 9, 8, 24, 90),
    P('Siraj', 9, 10, 8, 20, 90), P('Chahal', 10, 11, 6, 20, 88)] },
  { id: 'kol21', name: 'Kolkata', short: 'KOL', year: 2021, players: [
    P('Gill', 1, 2, 76, 82, 0), P('V. Iyer', 1, 2, 60, 88, 30), P('R. Tripathi', 3, 4, 60, 88, 0),
    P('N. Rana', 3, 4, 58, 84, 0), P('Morgan', 4, 5, 58, 92, 0), P('D. Karthik', 5, 6, 60, 92, 0, true),
    P('Shakib', 6, 7, 44, 70, 82), P('Narine', 7, 8, 24, 76, 94), P('Ferguson', 8, 9, 6, 20, 92),
    P('Varun C.', 9, 10, 6, 14, 88), P('P. Krishna', 10, 11, 6, 16, 88)] },
  // ---- CPL ----
  { id: 'tri20', name: 'Trinidad', short: 'TRI', year: 2020, players: [
    P('Simmons', 1, 2, 62, 80, 0), P('Munro', 1, 2, 68, 96, 0), P('Seifert', 3, 4, 56, 92, 0, true),
    P('Darren Bravo', 3, 4, 60, 76, 0), P('Pollard', 4, 6, 62, 96, 60), P('Bravo', 6, 7, 40, 86, 85),
    P('Narine', 7, 8, 20, 70, 95), P('Ali Khan', 8, 9, 6, 16, 82), P('F. Ahmed', 9, 10, 6, 14, 84),
    P('K. Pierre', 9, 10, 6, 14, 80), P('A. Phillip', 10, 11, 6, 14, 78)] },
  { id: 'jam16', name: 'Jamaica', short: 'JAM', year: 2016, players: [
    P('Walton', 1, 2, 60, 92, 0, true), P('Gayle', 1, 3, 80, 98, 20), P('Sangakkara', 3, 4, 84, 84, 0),
    P('R. Powell', 3, 4, 56, 86, 0), P('D. Smith', 4, 6, 58, 90, 50), P('Russell', 5, 6, 54, 98, 86),
    P('J. Mohammed', 6, 7, 54, 76, 0), P('Permaul', 8, 9, 10, 20, 84), P('N. Miller', 8, 10, 8, 20, 82),
    P('J. Taylor', 9, 10, 6, 16, 84), P('Cottrell', 10, 11, 6, 16, 90)] },
  // ---- BBL ----
  { id: 'hob24', name: 'Hobart', short: 'HOB', year: 2024, players: [
    P('McDermott', 1, 2, 60, 92, 0), P('Wade', 1, 3, 62, 92, 0, true), P('T. David', 3, 4, 60, 98, 0),
    P('M. Owen', 3, 5, 48, 94, 0), P('N. Chaudhary', 5, 6, 44, 88, 0), P('M. Wright', 5, 6, 42, 84, 0),
    P('W. Agar', 7, 8, 24, 60, 82), P('C. Jordan', 7, 8, 30, 76, 84), P('N. Ellis', 8, 9, 10, 30, 92),
    P('Meredith', 9, 10, 8, 20, 90), P('Hatzoglou', 10, 11, 6, 14, 80)] },
  { id: 'per23', name: 'Perth', short: 'PER', year: 2023, players: [
    P('Eskinazi', 1, 2, 58, 86, 0), P('Bancroft', 1, 2, 56, 76, 0), P('Inglis', 3, 5, 62, 92, 0, true),
    P('Laurie Evans', 3, 4, 62, 88, 0), P('A. Turner', 4, 5, 54, 92, 0), P('A. Hardie', 5, 6, 46, 88, 66),
    P('Agar', 7, 8, 22, 58, 82), P('J. Richardson', 8, 9, 8, 20, 90), P('Behrendorff', 9, 10, 6, 16, 90),
    P('A. Tye', 9, 10, 8, 20, 86), P('L. Morris', 10, 11, 6, 14, 90)] },
  { id: 'mel19', name: 'Melbourne', short: 'MEL', year: 2019, players: [
    P('Finch', 1, 2, 70, 90, 0), P('M. Harris', 1, 2, 60, 76, 0), P('T. Cooper', 3, 4, 56, 76, 0),
    P('S. Harper', 3, 5, 56, 84, 0, true), P('M. Gilkes', 4, 5, 50, 80, 0), P('D. Christian', 5, 6, 40, 90, 70),
    P('Nabi', 6, 7, 30, 84, 86), P('W. Sutherland', 7, 8, 30, 76, 76), P('Boyce', 8, 9, 8, 16, 82),
    P('K. Richardson', 9, 10, 6, 16, 90), P('J. Lalor', 10, 11, 6, 14, 80)] },
  // ---- SA20 ----
  { id: 'gqe24', name: 'Gqeberha', short: 'GQE', year: 2024, players: [
    P('Markram', 1, 3, 70, 86, 40), P('J. Hermann', 1, 2, 52, 84, 0, true), P('T. Abell', 3, 4, 50, 80, 0),
    P('Bedingham', 3, 4, 56, 84, 0), P('Stubbs', 4, 5, 60, 94, 0), P('Bairstow', 3, 5, 62, 92, 0, true),
    P('L. Dawson', 5, 7, 34, 72, 80), P('Jansen', 7, 8, 24, 76, 90), P('B. Carse', 8, 9, 12, 44, 86),
    P('S. Harmer', 9, 10, 10, 20, 86), P('Baartman', 10, 11, 6, 14, 86)] },
  { id: 'paa23', name: 'Paarl', short: 'PAA', year: 2023, players: [
    P('Buttler', 1, 2, 80, 94, 0, true), P('J. Roy', 1, 2, 68, 90, 0), P('van der Dussen', 3, 4, 74, 78, 0),
    P('Vilas', 3, 5, 58, 84, 0, true), P('Miller', 4, 6, 66, 94, 0), P('M. van Buuren', 6, 7, 38, 80, 60),
    P('F. Adams', 7, 8, 30, 76, 40), P('McCoy', 8, 9, 6, 16, 84), P('Ngidi', 9, 10, 6, 14, 90),
    P('Shamsi', 9, 10, 6, 14, 86), P('D. Olivier', 10, 11, 6, 14, 86)] },
  { id: 'joh23', name: 'Johannesburg', short: 'JOH', year: 2023, players: [
    P('du Plessis', 1, 2, 76, 86, 0), P('Hendricks', 1, 2, 66, 82, 0), P('Klaasen', 3, 5, 72, 98, 0, true),
    P('Moeen Ali', 3, 5, 52, 88, 60), P('L. du Plooy', 3, 4, 60, 84, 0), P('R. Shepherd', 6, 7, 28, 90, 76),
    P('A. Hosein', 7, 8, 20, 56, 86), P('G. Coetzee', 8, 9, 10, 40, 88), P('L. Williams', 9, 10, 6, 14, 86),
    P('Tahir', 10, 11, 6, 16, 94), P('B. Fortuin', 10, 11, 6, 14, 80)] },
  { id: 'pre23', name: 'Pretoria', short: 'PRE', year: 2023, players: [
    P('Salt', 1, 2, 72, 96, 0, true), P('W. Jacks', 1, 3, 62, 96, 40), P('Rossouw', 3, 4, 62, 90, 0),
    P('T. de Bruyn', 3, 4, 58, 80, 0), P('S. Dadswell', 4, 5, 50, 80, 0), P('Parnell', 6, 7, 28, 70, 84),
    P('M. Pretorius', 7, 8, 28, 70, 80), P('Nortje', 8, 9, 8, 20, 92), P('A. Rashid', 9, 10, 10, 30, 90),
    P('E. Bosch', 9, 10, 8, 20, 82), P('Dupavillon', 10, 11, 6, 14, 80)] },
  // ---- PSL ----
  { id: 'kar20', name: 'Karachi', short: 'KAR', year: 2020, players: [
    P('Babar', 1, 2, 88, 82, 0), P('Sharjeel', 1, 2, 60, 92, 0), P('J. Clarke', 3, 4, 58, 86, 0, true),
    P('Denly', 3, 4, 62, 76, 20), P('Iftikhar', 4, 6, 48, 88, 40), P('Imad', 6, 7, 30, 70, 84),
    P('A. Yamin', 7, 8, 26, 70, 80), P('M. Ilyas', 8, 9, 6, 14, 80), P('M. Amir', 9, 10, 6, 16, 92),
    P('A. Iqbal', 9, 10, 6, 14, 84), P('Shinwari', 10, 11, 6, 14, 86)] },
  { id: 'isl18', name: 'Islamabad', short: 'ISL', year: 2018, players: [
    P('Ronchi', 1, 2, 60, 94, 0, true), P('Hales', 1, 2, 74, 94, 0), P('Misbah', 3, 4, 66, 72, 0),
    P('Talat', 3, 5, 50, 82, 0), P('Asif Ali', 4, 5, 46, 94, 0), P('S. Patel', 5, 6, 46, 76, 70),
    P('Shadab', 6, 7, 28, 76, 88), P('F. Ashraf', 7, 8, 30, 82, 78), P('Rumman', 9, 10, 6, 14, 86),
    P('M. Sami', 9, 10, 6, 14, 84), P('Z. Gohar', 10, 11, 6, 14, 76)] },
  { id: 'mul21', name: 'Multan', short: 'MUL', year: 2021, players: [
    P('Rizwan', 1, 2, 82, 84, 0, true), P('S. Masood', 1, 3, 66, 76, 0), P('Rossouw', 3, 4, 62, 90, 0),
    P('S. Maqsood', 3, 5, 58, 82, 0), P('Khushdil', 5, 6, 40, 92, 0), P('S. Tanvir', 6, 8, 30, 76, 84),
    P('U. Mir', 8, 9, 10, 20, 82), P('Tahir', 9, 10, 6, 16, 92), P('Dahani', 9, 10, 6, 14, 88),
    P('J. Khan', 10, 11, 6, 14, 82), P('I. Khan', 10, 11, 6, 14, 78)] },
  { id: 'que19', name: 'Quetta', short: 'QUE', year: 2019, players: [
    P('Watson', 1, 2, 74, 90, 66), P('A. Shehzad', 1, 2, 62, 82, 0), P('Sarfaraz', 3, 5, 52, 80, 0, true),
    P('U. Akmal', 3, 4, 52, 84, 0), P('A. Ali', 4, 5, 54, 78, 0), P('Cutting', 6, 7, 38, 98, 82),
    P('M. Nawaz', 7, 8, 28, 70, 82), P('Anwar Ali', 8, 9, 24, 70, 74), P('Hasnain', 9, 10, 6, 14, 92),
    P('Z. Khan', 9, 10, 6, 14, 84), P('Naseem', 10, 11, 6, 14, 92)] },
  { id: 'pes23', name: 'Peshawar', short: 'PES', year: 2023, players: [
    P('Babar', 1, 2, 88, 84, 0), P('S. Ayub', 1, 2, 58, 90, 0), P('Kohler-Cadmore', 3, 4, 60, 90, 0),
    P('M. Haris', 3, 5, 52, 92, 0, true), P('R. Powell', 4, 6, 56, 86, 0), P('Talat', 5, 6, 50, 82, 0),
    P('A. Jamal', 7, 8, 28, 72, 78), P('W. Riaz', 8, 9, 10, 30, 84), P('S. Irshad', 9, 10, 6, 14, 86),
    P('A. Iqbal', 9, 10, 6, 14, 84), P('S. Muqeem', 10, 11, 6, 14, 80)] },
  // ---- The Hundred ----
  { id: 'lon21', name: 'London', short: 'LON', year: 2021, players: [
    P('J. Roy', 1, 2, 70, 92, 0), P('Billings', 1, 3, 56, 84, 0, true), P('W. Jacks', 3, 4, 62, 96, 40),
    P('Laurie Evans', 3, 5, 62, 88, 0), P('S. Curran', 5, 7, 36, 82, 88), P('S. Abbott', 6, 8, 20, 68, 88),
    P('Narine', 7, 8, 20, 72, 94), P('T. Curran', 8, 9, 14, 56, 86), P('Zampa', 9, 10, 6, 16, 90),
    P('G. Atkinson', 9, 11, 6, 14, 90), P('Topley', 10, 11, 6, 14, 86)] },
  { id: 'not22', name: 'Nottingham', short: 'NOT', year: 2022, players: [
    P('Hales', 1, 2, 74, 94, 0), P('T. Moores', 1, 3, 50, 84, 0, true), P('Root', 3, 4, 86, 84, 20),
    P('S. Mullaney', 4, 6, 50, 82, 40), P('S. Patel', 5, 6, 46, 76, 70), P('Imad', 6, 7, 30, 70, 84),
    P('L. Gregory', 7, 8, 22, 70, 82), P('D. Sams', 8, 9, 14, 70, 86), P('Rashid', 8, 9, 20, 84, 96),
    P('M. de Lange', 9, 10, 6, 14, 86), P('M. Carter', 10, 11, 6, 14, 78)] },
]
// Unique id per player-in-squad (same real player can appear in several seasons).
export const REGION = { che: 'IN', mum: 'IN', kol: 'IN', blr: 'IN', hyd: 'IN', jai: 'IN', amd: 'IN', pun: 'IN', del: 'IN', lko: 'IN',
  syd: 'AU', per: 'AU', hob: 'AU', mel: 'AU', ade: 'AU', bri: 'AU', tri: 'WI', jam: 'WI',
  gqe: 'SA', paa: 'SA', joh: 'SA', pre: 'SA', kar: 'PK', isl: 'PK', mul: 'PK', que: 'PK', pes: 'PK', lah: 'PK', lon: 'EN', not: 'EN' }
export const SQUADS = RAW.map((s) => ({ ...s, region: REGION[s.id.slice(0, 3)], players: s.players.map((p) => ({ ...p, id: `${s.id}:${p.name}`, sid: s.id, region: REGION[s.id.slice(0, 3)], team: s.short, year: s.year })) }))

export const SLOT_LABELS = ['Opener', 'Opener', 'No. 3', 'No. 4', 'No. 5', 'No. 6', 'No. 7', 'No. 8', 'No. 9', 'No. 10', 'No. 11']
export const TARGET = 300 // brand name; the top batting level is 320
export const BAT_LEVELS = 13
// Level 1 = chase 200, level 2 = 210 ... level 13 = 320
export const batTarget = (level) => 190 + 10 * Math.min(BAT_LEVELS, Math.max(1, level | 0 || 1))
export const BALLS = 120 // 20 overs

// ---- Bowling challenge: draft 5 bowlers (4 overs each) and defend against a daily opponent ----
export const BOWL_SLOTS = ['New ball', 'New ball', 'Middle overs', 'Middle overs', 'Death overs']
export const BOWL_LEVELS = 10
// Level 1 = hold them under 60, level 2 = 55, level 3 = 50 ... level 10 = 15
export const bowlTarget = (level) => 65 - 5 * Math.min(BOWL_LEVELS, Math.max(1, level | 0 || 1))
export const BOWL_MIN = 50 // minimum bowling rating to be draftable as a bowler
// over -> bowler slot index (each bowler gets exactly 4 overs)
export const BOWL_SCHEDULE = [0, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 3, 2, 3, 4, 0, 4, 1, 4, 4]
