const cloudinary = require("cloudinary").v2;

const connectCloudinary = () => {
    
    try {
        
        cloudinary.config({
            cloud_name: process.env.CLOUD_NAME,
			api_key: process.env.API_KEY,
			api_secret: process.env.API_SECRET, 
        });
        
        console.log("Cloudinary Connected")

    } catch (error) {
        console.log("Error while configuring cloudinary : ", error);
    }

}

module.exports = connectCloudinary;