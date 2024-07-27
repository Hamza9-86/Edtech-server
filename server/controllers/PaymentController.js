// const { default: mongoose } = require("mongoose");
// const Course = require("../models/Course");
// const { instance } = require("../config/razorpay");
// const mailSender = require("../utils/mailSender");

// exports.capturePayment = async (req, res) => {
//   try {
//     const { courseId } = req.body;
//     const userId = req.user.id;

//     if (!courseId) {
//       return res.status(401).json({
//         success: false,
//         message: "Invalid course id",
//       });
//     }
//     const courseDetails = await Course.findById(courseId);
//     if (!courseDetails) {
//       return res.status(404).json({
//         success: false,
//         message: "Course not found",
//       });
//     }
//     const uid = mongoose.Types.ObjectId(userId);
//     if (courseDetails.studentsEnrolled.includes(uid)) {
//       return res.status(401).json({
//         success: false,
//         message: "Student already enrolled",
//       });
//     }
//   } catch (error) {
//     return res.status(500).json({
//       success: false,
//       message: error.message,
//     });
//   }

//   const amount = courseDetails.price;
//   const currency = "INR";
//   const options = {
//     amount: amount * 100,
//     currency,
//     receipt: Math.random(Date.now()).toString(),
//     notes: {
//       courseId: courseDetails._id,
//       userId,
//     },
//   };
//   try {
//     const paymentResponse = await instance.orders.create(options);
//     return res.status(200).json({
//       success: true,
//       courseName: courseDetails.courseName,
//       courseDesc: courseDetails.courseDesc,
//       price: courseDetails.price,
//       thumbnail: courseDetails.thumbnail,
//       orderId: paymentResponse.id,
//       currency: paymentResponse.currency,
//       amount: paymentResponse.amount,
//     });
//   } catch (error) {
//     console.log(error);
//     res.json({
//       success: false,
//       message: "Could not initiate order",
//     });
//   }
// };

// exports.verifySignature = async (req, res) => {
//   const webhookSecret = "12345678";
//   const signature = req.headers["x-razorpay-signature"];

//   const shasum = await crypto.createHmac("sha256", webhookSecret);
//   shasum.update(JSON.stringify(req.body));
//   const digest = shasum.digest("hex");

//   if (signature == digest) {
//     console.log("payment authorised");
//     const { courseId, userId } = req.body.payload.payment.entitiy.notes;

//     try {
//       const courseDetails = await Course.findOneAndUpdate(
//         { _id: courseId },
//         {
//           $push: {
//             studentsEnrolled: userId,
//           },
//         },
//         { new: true }
//       );

//       if (!courseDetails) {
//         return res.status(500).json({
//           success: false,
//           message: "Course not Found",
//         });
//       }
//       const studentDetails = await User.findOneAndUpdate(
//         { _id: userId },
//         {
//           $push: {
//             courses: courseId,
//           },
//         },
//         { new: true }
//       );
//       console.log(studentDetails);

//       const mail = await mailSender(
//         studentDetails.email,
//         "Congratulations from EdTech",
//         "Congratulations, you are onboarded into new EdTech Course"
//       );
//       console.log(mail);
//       return res.status(200).json({
//         success: true,
//         message: "Signature Verified and Course Added",
//       });
//     } catch (error) {
//       return res.status(500).json({
//         success: false,
//         message: error.message,
//       });
//     }
//   } else {
//     return res.status(400).json({
//       success: false,
//       message: "Invalid request",
//     });
//   }
// };

const { instance } = require("../config/razorpay");
const Course = require("../models/Course");
const User = require("../models/User");
const mailSender = require("../utils/mailSender");
const { default: mongoose } = require("mongoose");
const crypto = require("crypto");
const {
  courseEnrollmentEmail,
} = require("../mail/templates/courseEnrollmentEmail");
const {
  paymentSuccessEmail,
} = require("../mail/templates/paymentSuccessEmail");
const CourseProgress = require("../models/CourseProgress");

//initiate the razorpay order
exports.capturePayment = async (req, res) => {
  const { courses } = req.body;
  //console.log(`courses`,courses);
  const userId = req.user.id;

  if (courses.length === 0) {
    return res.json({ success: false, message: "Please provide Course Id" });
  }

  let totalAmount = 0;

  for (const course_id of courses) {
    let course;
    try {
      course = await Course.findById(course_id);
      if (!course) {
        return res
          .status(200)
          .json({ success: false, message: "Could not find the course" });
      }

      const uid = new mongoose.Types.ObjectId(userId);
      if (course.studentsEnrolled.includes(uid)) {
        return res
          .status(200)
          .json({ success: false, message: "Student is already Enrolled" });
      }

      totalAmount += course.price;
    } catch (error) {
      console.log(error);
      return res.status(500).json({ success: false, message: error.message });
    }
  }
  const currency = "INR";
  const options = {
    amount: totalAmount * 100,
    currency,
    receipt: Math.random(Date.now()).toString(),
  };

  try {
    const paymentResponse = await instance.orders.create(options);
    res.json({
      success: true,
      message: paymentResponse,
    });
  } catch (error) {
    console.log(error);
    return res
      .status(500)
      .json({ success: false, mesage: "Could not Initiate Order" });
  }
};

//verify the payment
exports.verifyPayment = async (req, res) => {
  const razorpay_order_id = req.body?.razorpay_order_id;
  const razorpay_payment_id = req.body?.razorpay_payment_id;
  const razorpay_signature = req.body?.razorpay_signature;
  const courses = req.body?.courses;
  const userId = req.user.id;

  if (
    !razorpay_order_id ||
    !razorpay_payment_id ||
    !razorpay_signature ||
    !courses ||
    !userId
  ) {
    return res.status(200).json({ success: false, message: "Payment Failed" });
  }

  let body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_SECRET)
    .update(body.toString())
    .digest("hex");

  if (expectedSignature === razorpay_signature) {
    //enroll karwao student ko
    await enrollStudents(courses, userId, res);
    //return res
    return res.status(200).json({ success: true, message: "Payment Verified" });
  }
  return res.status(200).json({ success: "false", message: "Payment Failed" });
};

const enrollStudents = async (courses, userId, res) => {
  if (!courses || !userId) {
    return res.status(400).json({
      success: false,
      message: "Please Provide data for Courses or UserId",
    });
  }

  for (const courseId of courses) {
    try {
      //find the course and enroll the student in it
      const enrolledCourse = await Course.findOneAndUpdate(
        { _id: courseId },
        { $push: { studentsEnrolled: userId } },
        { new: true }
      );

      if (!enrolledCourse) {
        return res
          .status(500)
          .json({ success: false, message: "Course not Found" });
      }

      const courseProgress = await CourseProgress.create({
        courseID:courseId,
        userId:userId,
        completedVideos: [],
    })

      //find the student and add the course to their list of enrolledCOurses
      const enrolledStudent = await User.findByIdAndUpdate(
        userId,
        {
          $push: {
            courses: courseId,
            courseProgress: courseProgress._id,
          },
        },
        { new: true }
      );
      //console.log(`enroll`,enrolledStudent);
      ///bachhe ko mail send kardo
      const emailResponse = await mailSender(
        enrolledStudent.email,
        `Successfully Enrolled into ${enrolledCourse.courseName}`,
        courseEnrollmentEmail(
          enrolledCourse.courseName,
          `${enrolledStudent.firstName}`
        )
      );
      //console.log("Email Sent Successfully", emailResponse.response);
    } catch (error) {
      console.log(error);
      return res
        .status(500)
        .json({
          success: false,
          message: error.message,
          error: `Error in sending mail`,
        });
    }
  }
};

exports.sendPaymentSuccessEmail = async (req, res) => {
  const { orderId, paymentId, amount } = req.body;

  const userId = req.user.id;

  if (!orderId || !paymentId || !amount || !userId) {
    return res
      .status(400)
      .json({ success: false, message: "Please provide all the fields" });
  }

  try {
    //student ko dhundo
    const enrolledStudent = await User.findById(userId);
    await mailSender(
      enrolledStudent.email,
      `Payment Recieved`,
      paymentSuccessEmail(
        `${enrolledStudent.firstName}`,
        amount / 100,
        orderId,
        paymentId
      )
    );
  } catch (error) {
    console.log("error in sending mail", error);
    return res
      .status(500)
      .json({ success: false, message: "Could not send email" });
  }
};
