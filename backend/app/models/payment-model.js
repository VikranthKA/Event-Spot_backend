const {Schema,model} = require("mongoose")

const paymentSchema = new Schema({
    
    userId:{
        type:Schema.Types.ObjectId,
        ref:"UserModel"
    },
    bookingId:{
        type:Schema.Types.ObjectId,
        ref:"BookingModel"
    },
    paymentDate:Number,
    amount :Number,
    paymentType:String,
    status:{
        type:Boolean,   //Payment 
        default:false
    }
  


})

const PaymentModel = model("PaymentModel",paymentSchema)

module.exports = PaymentModel





     