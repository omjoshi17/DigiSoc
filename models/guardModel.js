const mongoose = require('mongoose');
const passportLocalMongoose = require('passport-local-mongoose');
const passport = require('passport');

const gaurdSchema = new mongoose.Schema (
	{
		validation: {
			type: String,
			required: true,
			default: 'applied'
		},
		societyName: {
			type: String,
			required: true
		},
		firstName: {
			type: String,
			required: true
		},
		lastName: {
			type: String,
			required: true
		},
		phoneNumber: {
			type: Number,
			required: true
		},
	},
	{
		timestamps: true
	}
);

guardSchema.plugin(passportLocalMongoose);
const Guard = mongoose.model("Guard",guardSchema);
passport.use(Guard.createStrategy());
passport.serializeUser(Guard.serializeUser());
passport.deserializeUser(Guard.deserializeUser());
exports.Guard = Guard;
