const express = require('express');
const bodyParser = require('body-parser');
const dotenv = require('dotenv')
const _ = require('lodash');
const session = require('express-session');
const passport = require('passport');
const MongoStore = require('connect-mongo');
const user_collection = require("./models/userModel");
const society_collection = require("./models/societyModel");
const visit_collection = require("./models/visitModel");
const db = require(__dirname+'/config/db');
const date = require(__dirname+'/date/date');






// Access environment variables
dotenv.config();
const stripe = require('stripe')(process.env.SECRET_KEY);
const app = express()
app.set('view engine','ejs');
app.use(express.static('public'));
// Middleware to handle HTTP post requests
app.use(express.urlencoded({extended: true}));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: "sessions",
    }),
    proxy: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());
db.connectDB()

const http = require('http');
const server = http.createServer(app);

const { Server } = require('socket.io');
const io = new Server(server);
const onlineResidents = {};
// Socket.IO logic here...
io.on('connection', (socket) => {
  console.log("User connected:", socket.id);

  socket.on("registerResident", (flatNumber) => {
    onlineResidents[flatNumber] = socket.id;
  });

  socket.on("disconnect", () => {
    for (const [flat, id] of Object.entries(onlineResidents)) {
      if (id === socket.id) {
        delete onlineResidents[flat];
        break;
      }
    }
  });
});

app.get("/", async (req,res) => {
	// Track page visits + users & societies registered
	try {
        let pageVisit = await visit_collection.Visit.findOne();
        if(!pageVisit) {
            pageVisit = new visit_collection.Visit({
                count: 0
            });
        }
        if (process.env.NODE_ENV === 'production') {
            pageVisit.count += 1;
        }
        await pageVisit.save();
        
        const societies = await society_collection.Society.find();
        const cities = societies.map(society => society.societyAddress.city.toLowerCase());
        const cityCount = new Set(cities).size;
        
        const foundUser = await user_collection.User.find();
        
        res.render("index", {
            city: cityCount,
            society: societies.length,
            user: foundUser.length,
            visit: pageVisit.count
        });
    } catch(err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

app.get("/login", (req,res) => {
	res.render("login");
});

app.get("/signup", (req,res) => {
    society_collection.Society.find()
        .then(societies => {
            console.log(societies.map(s => s.societyName));
            res.render("signup", {societies});
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
});

app.get("/register", (req,res) => {
	res.render("register");
});

app.get("/home", (req,res) => {
	if(req.isAuthenticated()){
		// Conditionally render home as per user validation status
        if(req.user.isGuard == true){
            res.redirect("/guardHomePage");
        } else{
		if(req.user.validation=='approved'){
			res.render("home");
		} else if(req.user.validation=='applied') {
			res.render("homeStandby",{
				icon: 'fa-user-clock',
				title: 'Account pending for approval',
				content: 'Your account will be active as soon as it is approved by your community.'+
                'It usually takes 1-2 days for approval. If it is taking longer to get approval, ' +
                'contact your society admin.'
			});
		} else {
			res.render("homeStandby",{
				icon: 'fa-user-lock',
				title: 'Account approval declined',
				content: 'Your account registration has been declined. '+
                'Please contact the society administrator for more details.' +
				'You can edit the request and apply again.'
			});
		}}
	} else {
		res.redirect("/login");
	}
});

app.get("/newRequest", (req,res) => {
    if(req.isAuthenticated() && req.user.validation!='approved'){
        society_collection.Society.find()
            .then(societies => {
                res.render("signupEdit", {user: req.user, societies});
            })
            .catch(err => {
                console.error(err);
                res.status(500).send("Server error");
            });
    } else {
        res.redirect("/home");
    }
})

app.get("/logout", (req,res) => {
	req.logout(function() {
        res.redirect("/")
    });
})

app.get("/loginFailure", (req,res) => {
	const failureMessage = "Sorry, entered password was incorrect, Please double-check.";
	const hrefLink = "/login";
	const secondaryMessage = "Account not created?";
	const hrefSecondaryLink = "/signup";
	const secondaryButton = "Create Account";
	res.render("failure",{
		message:failureMessage,
		href:hrefLink,
		messageSecondary:secondaryMessage,
		hrefSecondary:hrefSecondaryLink,
		buttonSecondary:secondaryButton
	})
});

app.get("/residents", async (req,res) => {
    if(req.isAuthenticated() && req.user.validation=='approved'){
        try {
            const userSocietyName = req.user.societyName;
            
            const allSocietyUsers = await user_collection.User.find({
              societyName: userSocietyName,
            });

            const foundUsers = [];
            const foundAppliedUsers = [];

            allSocietyUsers.forEach((user) => {
              if (user.validation === "approved") {
                foundUsers.push(user);
              } else if (user.validation === "applied") {
                foundAppliedUsers.push(user);
              }
            });
            
            res.render("residents", {
                societyResidents: foundUsers,
                appliedResidents: foundAppliedUsers,
                societyName: userSocietyName,
                isAdmin: req.user.isAdmin
            });
        } catch(err) {
            console.error(err);
            res.status(500).send("Server error");
        }
    } else {
        res.redirect("/login");
    }
})

app.get("/noticeboard", (req,res) => {
    if(req.isAuthenticated() && req.user.validation=='approved'){
        society_collection.Society.findOne(
          { societyName: req.user.societyName },
          { noticeboard: 1 }
        )
          .then((foundSociety) => {
            if (foundSociety) {
              // Check if no notice is present
              if (
                !foundSociety.noticeboard ||
                !foundSociety.noticeboard.length
              ) {
                foundSociety.noticeboard = [
                  {
                    subject:
                      "Access all important announcements, notices and circulars here.",
                  },
                ];
              }
              res.render("noticeboard", {
                notices: foundSociety.noticeboard,
                isAdmin: req.user.isAdmin,
              });
            }
          })
          .catch((err) => {
            console.error(err);
            res.status(500).send("Server error");
          });
    } else {
        res.redirect("/login");
    }
})

app.get("/notice", (req,res) => {
	if(req.isAuthenticated() && req.user.isAdmin){
		res.render("notice");
	} else {
		res.redirect("/login");
	}
})

app.get("/bill", async (req,res) => {
    if(req.isAuthenticated() && req.user.validation=='approved'){
        try {
            const foundUser = await user_collection.User.findById(req.user.id);
            const foundSociety = await society_collection.Society.findOne({societyName: foundUser.societyName});
            
            const dateToday = new Date();
            // Payment required for total number of months
            let totalMonth = 0;
            // If lastPayment doesn't exist
            let dateFrom = foundUser.createdAt;
            // If lastPayment exists
            if(foundUser.lastPayment.date){
                dateFrom = foundUser.lastPayment.date;
                totalMonth = date.monthDiff(dateFrom,dateToday);
            }
            else {
                // Add an extra month, as users joining date month payment's also pending
                totalMonth = date.monthDiff(dateFrom,dateToday) + 1;
            }
            
            // Calculate monthly bill of society maintenance
            const monthlyTotal = Object.values(foundSociety.maintenanceBill)
                .filter(ele => typeof(ele)=='number')
                .reduce((sum,ele) => sum+ele, 0);
                
            let credit = 0;
            let due = 0;
            if(totalMonth==0){
                // Calculate credit balance
                credit = monthlyTotal;
            }
            else if(totalMonth>1){
                // Calculate pending due
                due = (totalMonth-1)*monthlyTotal;
            }
            const totalAmount = monthlyTotal + due - credit;
            
            // Fetch validated society residents for admin features
            const foundUsers = await user_collection.User.find({
                $and: [
                    {"societyName": req.user.societyName},
                    {"validation": "approved"}
                ]
            });
            
            // Update amount to be paid on respective user collection
            foundUser.makePayment = totalAmount;
            await foundUser.save();
            
            res.render("bill", {
                resident: foundUser,
                society: foundSociety,
                totalAmount: totalAmount,
                pendingDue: due,
                creditBalance: credit,
                monthName: date.month,
                date: date.today,
                year: date.year,
                receipt: foundUser.lastPayment,
                societyResidents: foundUsers,
                monthlyTotal: monthlyTotal
            });
        } catch(err) {
            console.error(err);
            res.status(500).send("Server error");
        }
    } else {
        res.redirect("/login");
    }
})

app.get("/editBill", (req,res) => {
    if(req.isAuthenticated() && req.user.isAdmin){
        society_collection.Society.findOne(
            {societyName: req.user.societyName},
            {maintenanceBill: 1}
        )
            .then(foundSociety => {
                if(foundSociety){
                    res.render("editBill", {maintenanceBill: foundSociety.maintenanceBill});
                }
            })
            .catch(err => {
                console.error(err);
                res.status(500).send("Server error");
            });
    } else {
        res.redirect("/login");
    }
})

app.get("/downloadBill",(req,res) =>{
    res.render("downloadBill");
})

app.get("/helpdesk",(req,res) => {
    if(req.isAuthenticated() && req.user.validation=='approved') {
        // Conditionally render user/admin helpdesk
        if(req.user.isAdmin) {
            user_collection.User.find({
                $and: [
                    {"societyName": req.user.societyName}, 
                    {"validation": "approved"}
                ]
            })
                .then(foundUsers => {
                    res.render("helpdeskAdmin", {users: foundUsers});
                })
                .catch(err => {
                    console.error(err);
                    res.status(500).send("Server error");
                });
        } else {
            user_collection.User.find({
                $and: [
                    {"societyName": req.user.societyName}, 
                    {"validation": "approved"},
                    
                ]
            }).then(foundUsers => {
                res.render("helpdesk", {users: foundUsers,mainUser : req.user});
            })
            .catch(err => {
                console.error(err);
                res.status(500).send("Server error");
            });
            // Check if no complaint is present
            // if(!req.user.complaints.length){
            //     req.user.complaints = [{
            //         'category': 'You have not raised any complaint',
            //         'description': 'You can raise complaints and track their resolution by facility manager.'
            //     }];
            // }
            // res.render("helpdesk", {complaints: req.user.complaints,user:req.user});
        }
    } else {
        res.redirect("/login");
    }
})

app.get("/complaint",(req,res) => {
	if(req.isAuthenticated() && req.user.validation=='approved'){
		res.render("complaint");
	} else {
		res.redirect("/login");
	}
})

app.post("/approveResident",(req,res) => {
	const user_id = Object.keys(req.body.validate)[0]
	const validate_state = Object.values(req.body.validate)[0]
	user_collection.User.updateOne(
		{_id:user_id},
		{ $set: {
			validation: validate_state
		}}
	).then(() => res.redirect("/residents"))
})


app.get("/contacts",(req,res) => {
    if(req.isAuthenticated() && req.user.validation=='approved'){
        const userSocietyName = req.user.societyName;
        society_collection.Society.findOne(
            {"societyName": userSocietyName},
            {emergencyContacts: 1}
        )
            .then(foundSociety => {
                if(foundSociety){
                    res.render("contacts", {contact: foundSociety.emergencyContacts, isAdmin: req.user.isAdmin});
                }
            })
            .catch(err => {
                console.error(err);
                res.status(500).send("Server error");
            });
    } else {
        res.redirect("/login");
    }
})

app.get("/editContacts",(req,res) => {
    if(req.isAuthenticated() && req.user.isAdmin){
        society_collection.Society.findOne(
            {societyName: req.user.societyName},
            {emergencyContacts: 1}
        )
            .then(foundSociety => {
                if(foundSociety){
                    res.render("editContacts", {contact: foundSociety.emergencyContacts});
                }
            })
            .catch(err => {
                console.error(err);
                res.status(500).send("Server error");
            });
    } else {
        res.redirect("/login");
    }
})

app.get("/profile", (req,res) => {
    if(req.isAuthenticated() && req.user.validation=='approved'){
        user_collection.User.findById(req.user.id)
            .then(foundUser => {
                if(foundUser){
                    return society_collection.Society.findOne({societyName: foundUser.societyName})
                        .then(foundSociety => {
                            res.render("profile", {resident: foundUser, society: foundSociety});
                        });
                }
            })
            .catch(err => {
                console.error(err);
                res.status(500).send("Server error");
            });
    } else {
        res.redirect("/login");
    }
})

app.get("/editProfile", (req,res) => {
    if(req.isAuthenticated() && req.user.validation=='approved'){
        user_collection.User.findById(req.user.id)
            .then(foundUser => {
                if(foundUser){
                    return society_collection.Society.findOne({societyName: foundUser.societyName})
                        .then(foundSociety => {
                            res.render("editProfile", {resident: foundUser, society: foundSociety});
                        });
                }
            })
            .catch(err => {
                console.error(err);
                res.status(500).send("Server error");
            });
    } else {
        res.redirect("/login");
    }
})

app.get("/registerOption",(req,res)=>{
    res.render("registerOption");
})
//gaurd 

app.get("/guardRegister",(req,res) => {
    society_collection.Society.find()
        .then(societies => {
            // console.log(societies.map(s => s.societyName));
            res.render("guardRegister", {societies});
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
})

app.post("/guardRegister", async (req,res) => {
    try {
        // Signup only if society is created
        const foundSociety = await society_collection.Society.findOne({societyName: req.body.societyName});
        
        if(foundSociety) {
            const user = await user_collection.User.register(
                {
                    username: req.body.username,
                    societyName: req.body.societyName,
                    flatNumber: req.body.flatNumber,
                    firstName: req.body.firstName,
                    lastName: req.body.lastName,
                    phoneNumber: req.body.phoneNumber,
                    isGuard:true
                },
                req.body.password
            );

            await new Promise((resolve, reject) => {
                req.login(user, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
            
            res.redirect("/guardHomePage");
        } else {
            const failureMessage = "Sorry, society is not registered, Please double-check society name.";
            const hrefLink = "/signup";
            const secondaryMessage = "Society not registered?";
            const hrefSecondaryLink = "/register";
            const secondaryButton = "Register Society";
            res.render("failure", {
                message: failureMessage,
                href: hrefLink,
                messageSecondary: secondaryMessage,
                hrefSecondary: hrefSecondaryLink,
                buttonSecondary: secondaryButton
            });
        }
    } catch(err) {
        console.error(err);
        const failureMessage = "Sorry, this email address is not available. Please choose a different address.";
        const hrefLink = "/signup";
        const secondaryMessage = "Society not registered?";
        const hrefSecondaryLink = "/register";
        const secondaryButton = "Register Society";
        res.render("failure", {
            message: failureMessage,
            href: hrefLink,
            messageSecondary: secondaryMessage,
            hrefSecondary: hrefSecondaryLink,
            buttonSecondary: secondaryButton
        });
    }
});

app.get("/guardHomePage",async(req,res) => {
    
    
    if(req.isAuthenticated() && req.user.validation=='approved' && req.user.isGuard == true){
        try {
            
            const userSocietyName = req.user.societyName;
            
            const allSocietyUsers = await user_collection.User.find({
              societyName: userSocietyName,
            });

            const foundUsers = [];

            allSocietyUsers.forEach((user) => {
              if (user.validation === "approved") {
                foundUsers.push(user);
              } 
            });
            
            res.render("guardHomePage", {
                societyResidents: foundUsers,
                societyName: userSocietyName,
            });

            req.session.seenApprovedGuest = true;
        } catch(err) {
            console.error(err);
            res.status(500).send("Server error");
        }
    } else {
        res.redirect("/login");
    }
})

app.get("/sendNote", async (req, res) => {
    const {id} = req.query;
   
    try {
      const resident = await user_collection.User.findOne({
        _id:id
      });
     
      if (!resident) {
        return res.status(404).send("Resident not found");
      }
      
      // Render with resident data
      res.render("guestArrivalForm", { resident });
  
    } catch (err) {
      console.error(err);
      res.status(500).send("Server Error");
    }
  });
  

app.post("/guestArrivalNotification", (req,res) => {
    let {residentId} = req.body;
    console.log(residentId);
    user_collection.User.findOne({_id:residentId })
        .then(foundUser => {
            if(foundUser){
                const guest = {
                    'date': date.dateString,
                    'guestName': req.body.guestName,
                    'details': req.body.details,
                    'approved':"pending"
                };
                foundUser.guests.push(guest);
                return foundUser.save()
                    .then(() => {
                        console.log(foundUser);
                        io.to(foundUser.flatNumber).emit("guestRequest", {
                            guestName: "John Doe"
                          });
                          
                        res.redirect("/guardHomePage");
                    });
            }
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
})

app.get("/guests", async (req, res) => {
    if (req.isAuthenticated() && req.user.validation === 'approved') {
      try {
        // Declare foundGuests array
        const foundGuests = [];
  
        // Make sure req.user.guests exists and is an array
        if (Array.isArray(req.user.guests)) {
          req.user.guests.forEach((guest) => {
            if (guest.approved === "pending") {
              foundGuests.push(guest);
            }
          });
        }
        
        res.render("guests", {
          guestsArrived: foundGuests,
          user:req.user
        });
  
      } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
      }
    } else {
      res.redirect("/login");
    }
  });
  
app.get("/deleteGuests", async(req,res) => {

    await user_collection.User.updateOne(
        { firstName: "Diya" },
        { $set: { guests: [] } }
      );
});

app.post("/approveGuest",(req,res) => {
	const user_id = req.user._id;
    const guest_name = req.body.guestname;
    console.log("id of the user is ",user_id);
    console.log(guest_name);
    if(req.body.status === "approved"){
	user_collection.User.updateOne(
        
        { _id: user_id, "guests.guestName": guest_name }, // Match the guest inside the array
        { $set: { "guests.$.approved": "approved",
            "guests.$.approvedAt": new Date()
         } }       // Use positional operator to set status
    ).then(() => res.redirect("/guests"))
    }
    if(req.body.status === "declined"){
        user_collection.User.updateOne(
            
            { _id: user_id, "guests.guestName": guest_name }, // Match the guest inside the array
            { $set: { "guests.$.approved": "declined",
                "guests.$.approvedAt": new Date()
             } }       // Use positional operator to set status
        ).then(() => res.redirect("/guests"))
        }
});

app.get("/approvedGuestList",async(req,res)=>{
    if(req.isAuthenticated() && req.user.validation=='approved' && req.user.isGuard == true){
        try {
            
            const userSocietyName = req.user.societyName;
            
            const allSocietyUsers = await user_collection.User.find({
              societyName: userSocietyName,
            });

            const foundUsers = [];

            allSocietyUsers.forEach((user) => {
              if (user.validation === "approved") {
                foundUsers.push(user);
              } 
            });
            
            res.render("approvedGuestList", {
                societyResidents: foundUsers,
                societyName: userSocietyName,
            });

            
        } catch(err) {
            console.error(err);
            res.status(500).send("Server error");
        }
    } else {
        res.redirect("/login");
    }
});

app.get("/guestVisited", async (req, res) => {
    const { id, guestname } = req.query;
    
    try {
        const updateResult = await user_collection.User.updateOne(
            { _id: id },
            { $pull: { guests: { guestName: guestname } } }
          );
      
          if (updateResult.modifiedCount === 1) {
            res.redirect("/approvedGuestList");
          } else {
            res.status(404).send("Guest not found or already deleted");
          }
  
      
    } catch (err) {
      console.error(err);
      res.status(500).send("Server Error");
    }
  });
  
  

app.get("/updateFlatNum",async(req,res)=>{
    const result = await user_collection.User.updateMany(
        { isGuard: true },
        { $set: { flatNumber: '000' } }
      );
      
      console.log(`${result.modifiedCount} users updated.`);
      
})

app.get('/success', async (req, res) => {
    try {
        
        const session = await stripe.checkout.sessions.retrieve(req.query.session_id);
        
        if (session.customer) {
            const customer = await stripe.customers.retrieve(session.customer);
            // Do something with the customer
        } else {
            // Use session.customer_email instead
            console.log('Customer not created. Email:', session.customer_email);
        }
        const customer = await stripe.customers.retrieve(session.customer);
        
        const foundUser = await user_collection.User.findOne({_id: req.user.id});
        foundUser.lastPayment.date = new Date(customer.created*1000);
        foundUser.lastPayment.amount = session.amount_total/100;
        foundUser.lastPayment.invoice = customer.invoice_prefix;
        
        await foundUser.save();
        
        const transactionDate = new Date(customer.created*1000).toLocaleString().split(', ')[0];
        res.render("success", {
            invoice: customer.invoice_prefix,
            amount: session.amount_total/100,
            date: transactionDate
        });
    } catch(err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

app.post('/checkout-session', async (req, res) => {
	try {
		const session = await stripe.checkout.sessions.create({
			payment_method_types: ['card'],
			mode: 'payment',
			customer_email: req.user.email, // Optional: req.user.email
            customer_creation: 'always',
			line_items: [
				{
					price_data: {
						currency: 'inr',
						product_data: {
							name: req.user.societyName,
							images: ['https://www.flaticon.com/svg/vstatic/svg/3800/3800518.svg'],
						},
						unit_amount: req.user.makePayment * 100, // make sure it's a number
					},
					quantity: 1,
				},
			],
			success_url: 'http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}',
			cancel_url: 'http://localhost:3000/bill',
		});

		res.json({ id: session.id });
	} catch (err) {
		console.error('Stripe session creation error:', err);
		res.status(500).json({ error: err.message });
	}
});


app.post("/complaint", (req,res) => {
    user_collection.User.findById(req.user.id)
        .then(foundUser => {
            if(foundUser){
                const complaint = {
                    'date': date.dateString,
                    'category': req.body.category,
                    'type': req.body.type,
                    'description': req.body.description,
                    'status': 'open'
                };
                foundUser.complaints.push(complaint);
                return foundUser.save()
                    .then(() => {
                        res.redirect("/helpdesk");
                    });
            }
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
})
  
app.post("/closeTicket", (req,res) => {
    const user_id = Object.keys(req.body.ticket)[0];
    const ticket_index = Object.values(req.body.ticket)[0];
    const ticket = 'complaints.'+ticket_index;
    
    // Find user for fetching ticket data
    user_collection.User.findById(user_id)
        .then(foundUser => {
            if(foundUser){
                const complaintToDelete = foundUser.complaints[ticket_index];

                return user_collection.User.updateOne(
                    { _id: user_id },
                    {
                        $pull: {
                            complaints: {
                                date: complaintToDelete.date,
                                category: complaintToDelete.category,
                                type: complaintToDelete.type,
                                description: complaintToDelete.description
                            }
                        }
                    }
                )
                    .then(() => {
                        res.redirect("/helpdesk");
                    });
            }
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
});

app.post("/notice", (req,res) => {
    society_collection.Society.findOne({societyName: req.user.societyName})
        .then(foundSociety => {
            if(foundSociety){
                const notice = {
                    'date': date.dateString,
                    'subject': req.body.subject,
                    'details': req.body.details
                };
                foundSociety.noticeboard.push(notice);
                return foundSociety.save()
                    .then(() => {
                        res.redirect("/noticeboard");
                    });
            }
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
});

app.post("/editBill", (req,res) => {
    society_collection.Society.updateOne(
        {societyName: req.user.societyName},
        { $set: {
            maintenanceBill: {
                societyCharges: req.body.societyCharges,
                repairsAndMaintenance: req.body.repairsAndMaintenance,
                sinkingFund: req.body.sinkingFund,
                waterCharges: req.body.waterCharges,
                insuranceCharges: req.body.insuranceCharges,
                parkingCharges: req.body.parkingCharges
            }
        }}
    )
        .then(() => {
            res.redirect("/bill");
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
});

app.post("/editContacts", (req,res) => {
    society_collection.Society.updateOne(
        {societyName: req.user.societyName},
        { $set: {
            emergencyContacts: {
                plumbingService: req.body.plumbingService,
                medicineShop: req.body.medicineShop,
                ambulance: req.body.ambulance,
                doctor: req.body.doctor,
                fireStation: req.body.fireStation,
                guard: req.body.guard,
                policeStation: req.body.policeStation
            }
        }}
    )
        .then(() => {
            res.redirect("/contacts");
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
});

app.post("/editProfile", (req,res) => {
    user_collection.User.updateOne(
        {_id: req.user.id},
        { $set: { 
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            phoneNumber: req.body.phoneNumber,
            flatNumber: req.body.flatNumber
        }}
    )
        .then(() => {
            // Update society data if any ~admin
            if(req.body.address){
                return society_collection.Society.updateOne(
                    {admin: req.user.username},
                    { $set: { 
                        societyAddress: {
                            address: req.body.address,
                            city: req.body.city,
                            district: req.body.district,
                            postalCode: req.body.postalCode
                        }
                    }}
                )
                    .then(() => {
                        res.redirect("/profile");
                    });
            } else {
                res.redirect("/profile");
            }
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
});

app.post("/newRequest", (req,res) => {
    // Submit new signup only if society exists
    society_collection.Society.findOne({societyName: req.body.societyName})
        .then(foundSociety => {
            if(foundSociety){
                return user_collection.User.updateOne(
                    {_id: req.user.id},
                    { $set: {
                        firstName: req.body.firstName,
                        lastName: req.body.lastName,
                        phoneNumber: req.body.phoneNumber,
                        societyName: req.body.societyName,
                        flatNumber: req.body.flatNumber,
                        validation: 'applied'
                    }}
                )
                    .then(() => {
                        res.redirect("/home");
                    });
            } else {
                const failureMessage = "Sorry, society is not registered, Please double-check society name.";
                const hrefLink = "/newRequest";
                const secondaryMessage = "Account not created?";
                const hrefSecondaryLink = "/signup";
                const secondaryButton = "Create Account";
                res.render("failure", {
                    message: failureMessage,
                    href: hrefLink,
                    messageSecondary: secondaryMessage,
                    hrefSecondary: hrefSecondaryLink,
                    buttonSecondary: secondaryButton
                });
            }
        })
        .catch(err => {
            console.error(err);
            res.status(500).send("Server error");
        });
});

app.post("/signup", async (req,res) => {
    try {
        // Signup only if society is created
        const foundSociety = await society_collection.Society.findOne({societyName: req.body.societyName});
        
        if(foundSociety) {
            const user = await user_collection.User.register(
                {
                    username: req.body.username,
                    societyName: req.body.societyName,
                    flatNumber: req.body.flatNumber,
                    firstName: req.body.firstName,
                    lastName: req.body.lastName,
                    phoneNumber: req.body.phoneNumber
                },
                req.body.password
            );

            await new Promise((resolve, reject) => {
                req.login(user, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });
            
            res.redirect("/home");
        } else {
            const failureMessage = "Sorry, society is not registered, Please double-check society name.";
            const hrefLink = "/signup";
            const secondaryMessage = "Society not registered?";
            const hrefSecondaryLink = "/register";
            const secondaryButton = "Register Society";
            res.render("failure", {
                message: failureMessage,
                href: hrefLink,
                messageSecondary: secondaryMessage,
                hrefSecondary: hrefSecondaryLink,
                buttonSecondary: secondaryButton
            });
        }
    } catch(err) {
        console.error(err);
        const failureMessage = "Sorry, this email address is not available. Please choose a different address.";
        const hrefLink = "/signup";
        const secondaryMessage = "Society not registered?";
        const hrefSecondaryLink = "/register";
        const secondaryButton = "Register Society";
        res.render("failure", {
            message: failureMessage,
            href: hrefLink,
            messageSecondary: secondaryMessage,
            hrefSecondary: hrefSecondaryLink,
            buttonSecondary: secondaryButton
        });
    }
});

app.post("/register", async (req,res) => {
    try {
        // Signup only if society not registered
        const existingSociety = await society_collection.Society.findOne({societyName: req.body.societyName});
        
        if(!existingSociety) {
            const user = await user_collection.User.register(
                {
                    validation: 'approved',
                    isAdmin: true,
                    username: req.body.username,
                    societyName: req.body.societyName,
                    flatNumber: req.body.flatNumber,
                    firstName: req.body.firstName,
                    lastName: req.body.lastName,
                    phoneNumber: req.body.phoneNumber
                },
                req.body.password
            );
            
            await new Promise((resolve, reject) => {
                req.login(user, (err) => {
                    if(err) return reject(err);
                    resolve();
                });
            });
            
            // Create new society in collection
            const society = new society_collection.Society({
                societyName: user.societyName,
                societyAddress: {
                    address: req.body.address,
                    city: req.body.city,
                    district: req.body.district,
                    postalCode: req.body.postalCode
                },
                admin: user.username
            });
            
            await society.save();
            res.redirect("/home");
        } else {
            const failureMessage = "Sorry, society is already registered, Please double-check society name.";
            const hrefLink = "/register";
            const secondaryMessage = "Account not created?";
            const hrefSecondaryLink = "/signup";
            const secondaryButton = "Create Account";
            res.render("failure", {
                message: failureMessage,
                href: hrefLink,
                messageSecondary: secondaryMessage,
                hrefSecondary: hrefSecondaryLink,
                buttonSecondary: secondaryButton
            });
        }
    } catch(err) {
        console.error(err);
        res.redirect("/register");
    }
});

app.post("/login", passport.authenticate("local", {
	successRedirect: "/home",
	failureRedirect: "/loginFailure"
}));

app.get("/health", (req, res) => {
    res.status(200).send("Server is running");
});

// app.listen(
//     process.env.PORT || 3000, 
//     console.log("Server started")
// );

server.listen(3000, () => {
    console.log("Server running on port 3000 with WebSockets");
  });
