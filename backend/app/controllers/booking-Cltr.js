const { validationResult } = require("express-validator");
const BookingModel = require("../models/booking-model");
const EventModel = require("../models/event-model");
const ProfileModel = require("../models/profile-model")
const ReviewModel = require("../models/review-model")
const moment=require("moment")
const cron = require("node-cron");
const funEmail = require("../utils/NodeMailer/email");

const bookingCltr = {};

bookingCltr.createBooking = async (req, res) => {

    const error = validationResult(req)
    if(!error.isEmpty()){
        return res.status(400).json({err:error.array()})
    }
    const { eventId } = req.params
    const { tickets } = req.body;
    console.log(tickets)

    try {
        const profile = await ProfileModel.findOne({userId : req.user.id})
        if(!profile) await new ProfileModel({userId:req.user.id}).save()
        const event = await EventModel.findById({_id:eventId})
        if (!event) {
            return res.status(404).json({ error: 'Cannot find the Event' });
        }
        // Transform the incoming tickets array to match the BookingModel structure
        const transformedTickets = tickets.map(ticket => ({
            ticketId: ticket._id,
            ticketType: ticket.ticketName,  // Assuming _id is the reference to EventModel
            quantity: ticket.Quantity,
            ticketPrice: ticket.ticketPrice,
            totalAmount: ticket.ticketPrice * ticket.Quantity, // Include totalAmount for each ticket
        }));
        const totalAmount = transformedTickets.reduce((total, ticket) => total + (ticket.ticketPrice * ticket.Quantity), 0);

        // Check if there are enough available seats for the specified ticket types
        const availableSeats = transformedTickets.every(ticket => {
            const matchingTicket = event.ticketType.find(eventTicket => eventTicket.ticketName === ticket.ticketType);

            if (!matchingTicket) {
                return false; // Ticket not found in the event.ticketType array
            }

            return matchingTicket.remainingTickets >= ticket.quantity;
        });



        if (!availableSeats) {
            return res.status(400).json({ error: 'Not enough available seats for the specified ticket types' });
        }


        const booking = new BookingModel({
            userId: req.user.id,
            eventId,
            tickets: transformedTickets,
            totalAmount: totalAmount,
        })


        const updatedTicketTypes = event.ticketType.map(eventTicket => {
            const matchingTicket = transformedTickets.find(ticket => ticket.ticketType === eventTicket.ticketName);

            if (matchingTicket) {
                // Subtract the booked quantity from the remaining tickets
                eventTicket.remainingTickets -= matchingTicket.quantity;

            }

            return eventTicket;
        });

const eventUpdate = await EventModel.findByIdAndUpdate(eventId, {
    ticketType: updatedTicketTypes,
}, { new: true })

await booking.save()

let events = await EventModel.find({isApproved:true}).populate({
    path: "organiserId", select: "_id username email"
})
.populate({
    path: "categoryId", select: "name"
})
.populate({
    path: 'reviews',
    populate: {
        path: 'reviewId',
        model: 'ReviewModel',
    }
});

// Populate the userId field inside each review object
for (let event of events) {
await ReviewModel.populate(event.reviews, { path: 'reviewId.userId', select: '_id username email' });
}


return res.status(201).json({ booking, updatedEvents:events })
    } catch (err) {
        console.error(err);
        return res.status(500).json(err);
    }
};

bookingCltr.TicketsInfo = async (req, res) => {
    const { bookedId } = req.params
    try {
        const ticketInfo = await BookingModel.findOne(
            {
                _id: bookedId,
                userId: req.user.id

            }).populate(
                {
                    path: "userId",
                    select: "_id username email"
                }).populate(
                    {
                        path: "eventId",
                        select: "title eventStartDateTime venueName"
                    })

        if (!ticketInfo) return res.status(404).json("Ticket Not Found")


        return res.status(200).json(ticketInfo)

    } catch (err) {
        console.log(err)
        return res.status(500).json(err)

    }

}

bookingCltr.getAllBookings = async(req,res)=>{
    try{
        const bookings = []
        const foundbookings = await BookingModel.findOne({userId:req.user.id,status:false}).populate({path:"eventId",select:"_id title eventStartDateTime"})
        if(Object.keys(foundbookings).length<0) return res.json("Every thing is Booked status true")
        bookings.push(foundbookings)
        const today = moment().startOf('day')//dis is the today date
        const filterBookings = bookings.filter(booking =>{
            const eventStartDateTime = moment(booking.eventId.eventStartDateTime)
            return eventStartDateTime.isAfter(today)
        })
        return res.status(200).json(filterBookings)
    }catch(err){
        console.log(err)
        return res.status(200).json(err)
    }
}


async function cancelBookingFunction(bookingId){
    try {
        // Find the booking
        console.log("In booking")
        const booking = await BookingModel.findById(bookingId)
        console.log(booking)
        
        // Find the event
        const event = await EventModel.findById(booking.eventId);
        
        // Update ticket availability for the event
        const updatedTicketTypes = event.ticketType.map(eventTicket => {
            const matchingTicket = booking.tickets.find(ticket => ticket.ticketType === eventTicket.ticketName);
            if (matchingTicket) {
                // Increment remaining tickets by the quantity of the booked tickets
                eventTicket.remainingTickets += matchingTicket.quantity;
            }
            return eventTicket;
        });
        const cancelBooking   =  await BookingModel.findByIdAndDelete(bookingId)
        // Update the event with the updated ticket types
        const updatedEvent = await EventModel.findByIdAndUpdate(
            booking.eventId,
            { ticketType: updatedTicketTypes },
            { new: true }
        );
        console.log(updatedEvent)
        return updatedEvent
    } catch (err) {
        console.log(err);
        // You should handle the response in case of an error
        // res.status(500).json(err);
        throw err; // Optionally, re-throw the error to be handled by the caller
    }
}


// cron.schedule('* * * * *',async()=>{
//     try{
//         const bookingToCancel = await BookingModel.find({status:false})

//         bookingToCancel.forEach(async booking=>{
//             await cancelBookingFunction(booking._id)
//         })
//     }catch(err){
//         console.log("Error in the cancel booking in cron",err)
//     }
// })


cron.schedule("0 0 * * *", async () => {
    console.log("inside cron")
    try {
        // Find bookings with event start time within the next 5 minutes
        const currentDateTime = new Date()
        const futureDateTime = new Date(currentDateTime.getTime() + 5 * 60000)// 5 minutes from now
        const bookings = await BookingModel.find().populate({
            path: 'eventId',
            match: {
                'eventStartDateTime': { $lte: futureDateTime }
            },
            select: 'eventStartDateTime' // Populate only the eventStartDateTime field
        }).populate({
            path: 'userId',
            select: 'email'
        });
        console.log(bookings)

        // Filter out bookings where eventId.eventStartDateTime is less than or equal to futureDateTime
        const filteredBookings = bookings.filter(booking => booking.eventId !== null);


        filteredBookings.forEach(async (booking) => {
            const userEmail = booking.userId.email;
            const eventStart = booking.eventId.eventStartDateTime; // Access eventStartDateTime from populated eventId
            const eventTitle = booking.eventId.title; // Assuming you have a 'title' field in your EventModel

            await funEmail({
                email: userEmail,
                subject: `Event Reminder: ${eventTitle}`,
                message: `Your event "${eventTitle}" starts in 5 minutes at ${eventStart}.`
              })

            
            console.log(`Reminder email sent to ${userEmail}`);
        });
    } catch (error) {
        console.error('Error sending email reminders:', error);
    }
})

///write a logic in the FE and show Timer of the 5 min if the times exists more then, call canelPayment and also add button to the says cancel payment
bookingCltr.cancelBooking = async (req, res) => {
    const { bookingId } = req.params //send the form front end 
    try {
        const booking = await BookingModel.find({ _id: bookingId})
        //check the if the payment is create for this user and ticket if that sucess then say payment done
        if(!booking) return res.status(404).json("Booking not found")
       const data =  await cancelBookingFunction(bookingId)
       if(!data) return res.status(400).json("Somthing went wrong")
       console.log("success")
       return res.status(200).json({updatedEvent:data})

        //in the backend if the booking are created and not yet confirmed within 10 min auto cancel the booking

        if (!booking) {
            return res.status.json(404).json(bookedEvent)
        }else {
            const event = await EventModel.findById(booking.eventId)
            const updatedTicketTypes = event.ticketType.map(eventTicket=>{
                const matchingTicket = booking.tickets.find(ticket=>ticket.ticketType === eventTicket.ticketName)
                if(matchingTicket){
                    eventTicket.remainingTickets += matchingTicket
                }
                return eventTicket
            })

            const updatedEvent = await EventModel.findByIdAndUpdate(booking.eventId,{
                ticketType : updatedTicketTypes
            },{new:true})

            // check if the id is in the booking

        return res.status(200).json({msg:"Your confirmed seats are canceled"})
        }
    } catch (err) {
        console.log(err)
        return res.status(500).json(err)
    }
}



module.exports = {bookingCltr,cancelBookingFunction}