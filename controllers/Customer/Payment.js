const Razorpay = require('razorpay');
const asyncHandler = require("../../middlewares/asyncHandler");
const Order = require("../../models/Order");
const Cart = require("../../models/Cart");
const Customer = require("../../models/Customer");
const Payment = require("../../models/Payment");
const mailSender = require("../../utils/mailSender");
const { orderPlacedEmail } = require("../../mailTemplate/OrderPlaced");
const crypto = require("crypto");

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});


exports.processPayment = asyncHandler(async (req, res) => {
    const { user, amount, items, deliveryAddress } = req.body.data;

    const options = {
        amount: amount * 100,
        currency: "INR",
        receipt: `receipt_${Date.now()}`,
        payment_capture: 1
    };

    try {
        const response = await razorpay.orders.create(options);

        const customer = await Customer.findOne({ _id: user._id });

        const payment = new Payment({
            customer: user._id,
            orderId: response.id,
            amount: amount,
            currency: "INR",
            items,
            status: "created",
            deliveryAddress
        });
        await payment.save();

        customer.payments.push(payment._id);
        await customer.save();

        return res.status(200).json({
            id: response.id,
            currency: response.currency,
            amount: response.amount,
            key: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        console.error('Error:', error);
        return res.status(400).json({
            error: 'An error occurred while creating the order'
        });
    }
});

exports.createPaymentLink = asyncHandler(async (req, res) => {
    const { amount, currency, description } = req.body;

    const options = {
        amount: amount * 100,
        currency: currency,
        accept_partial: false,
        first_min_partial_amount: 0,
        description: description,
    };

    try {
        const response = await razorpay.paymentLink.create(options);
        return res.status(200).json({
            success: true,
            paymentLink: response.short_url // Link to generate a QR code
        });
    } catch (error) {
        console.error('Error creating payment link:', error);
        return res.status(400).json({
            success: false,
            message: 'Failed to create payment link'
        });
    }
});


exports.checkPaymentStatus = asyncHandler(async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest("hex");

    const isAuthentic = expectedSignature === razorpay_signature;

    if (isAuthentic) {
        const payment = await Payment.findOne({ orderId: razorpay_order_id });
        const customer = await Customer.findOne({ _id: payment.customer });
        const cart = await Cart.findOne({ _id: customer.cart });

        payment.status = "captured";
        payment.paymentId = razorpay_payment_id;
        payment.signature = razorpay_signature;

        await payment.save();

        // Create new order
        const order = new Order({
            customer: payment.customer,
            orderItems: payment.items,
            paymentInfo: {
                id: payment._id,
                status: payment.status
            },
            totalPrice: payment.amount,
            paidAt: new Date(),
            shippingAddress: payment.deliveryAddress,
            paymentStatus: "paid",
            orderStatus: "processing"
        });
        await order.save();

        customer.orders.push(order._id);
        await customer.save();

        // Clear cart
        cart.items = [];
        await cart.save();

        // Send order confirmation email
        try {
            await mailSender(
                customer.email,
                "Order Placed",
                orderPlacedEmail(
                    customer.firstName,
                    payment.deliveryAddress,
                    payment.items,
                    payment.amount,
                    order.orderId
                )
            );
        } catch (error) {
            console.error('Error sending email:', error);
        }

        return res.status(200).json({
            message: "Payment successful",
            success: true
        });
    } else {
        return res.status(400).json({
            message: "Payment verification failed",
            success: false
        });
    }
});



exports.cashOnDelivery = asyncHandler(async (req, res) => {

    const { amount, items, deliveryAddress } = req.body;

    if (!amount) {
        return res.status(401).json({
            message: "Please select amount.",
            success: false
        })
    }

    if (!items) {
        return res.status(401).json({
            message: "Please select order items.",
            success: false
        })
    }

    if (!deliveryAddress) {
        return res.status(401).json({
            message: "Please select delivery address.",
            success: false
        })
    }

    const customer = await Customer.findOne({ _id: req.user.id });
    const cart = await Cart.findOne({ _id: customer.cart });

    // Create new order
    const order = new Order({
        customer: req.user.id,
        orderItems: items,
        totalPrice: amount,
        paymentInfo: {
            id: "NA",
            status: "Cash on delivery"
        },
        shippingAddress: deliveryAddress,
        paymentStatus: "Cash on delivery",
        orderStatus: "processing"
    });
    await order.save();

    customer.orders.push(order._id);
    await customer.save();

    // Clear cart
    cart.items = [];
    await cart.save();


    // send complaint registration email
    try {
        await mailSender(
            customer.email,
            "Order Placed",
            orderPlacedEmail(
                customer.firstName,
                deliveryAddress,
                items,
                amount,
                order.orderId
            )
        )
    }
    catch (error) {
        throw Error(error);
    }

    return res.status(200).json({
        message: "Order Placed Successfully",
        success: true
    })

})