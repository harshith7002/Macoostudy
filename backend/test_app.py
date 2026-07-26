import unittest
from unittest.mock import patch, MagicMock
import io
import json
import sys
import os

# Add backend directory to path if needed to ensure app import works
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app import app

# Create mock module structure for google-generativeai to handle potential imports securely
# and satisfy the user's explicit requirement of mocking GenerativeModel.generate_content
sys.modules['google'] = MagicMock()
sys.modules['google.generativeai'] = MagicMock()

class FlaskAppTestCase(unittest.TestCase):
    def setUp(self):
        # Set up Flask test client
        self.app = app.test_client()
        self.app.testing = True

    def test_root_health_get(self):
        """
        Test Case: GET request to '/'
        Verifies that root health page returns status code 200 with ok status.
        """
        response = self.app.get('/')
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertEqual(data.get("status"), "ok")

    @patch('app.get_db')
    @patch('app.client.chat.completions.create')
    @patch('app.extract_text_from_pdf')
    @patch('google.generativeai.GenerativeModel')
    def test_roast_endpoint_success(self, mock_gemini_model, mock_extract_pdf, mock_groq_completions, mock_get_db):
        """
        Test Case: POST to '/roast' with valid PDF file and parameters.
        Verifies that text extraction, AI completions, and database insertion are mocked,
        returning a successful JSON response with roasted content.
        """
        # 1. Mock Google Generative AI to satisfy the explicit test requirement
        mock_model_instance = MagicMock()
        mock_gemini_model.return_value = mock_model_instance
        mock_response = MagicMock()
        mock_response.text = "Mocked Gemini Roast: Your resume looks great but needs more action verbs."
        mock_model_instance.generate_content.return_value = mock_response

        # 2. Mock Groq client which the real Flask app uses internally
        mock_message = MagicMock()
        mock_message.content = "Mocked Groq Roast: Your experience bullets lack metrics."
        mock_choice = MagicMock()
        mock_choice.message = mock_message
        mock_completion_res = MagicMock()
        mock_completion_res.choices = [mock_choice]
        mock_groq_completions.return_value = mock_completion_res

        # 3. Mock PDF extraction to return a valid string payload (>100 characters)
        mock_extract_pdf.return_value = (
            "Senior Software Engineer with 8 years of experience building Python Flask backends and React apps. "
            "Led a team of 4 engineers and improved system response times by 35% using Redis caching."
        )

        # 4. Mock Database calls
        mock_db_conn = MagicMock()
        mock_get_db.return_value = mock_db_conn

        # Prepare a valid mock PDF payload (must start with b'%PDF' to bypass extraction validations if called)
        pdf_data = b"%PDF-1.4 mock pdf contents"
        
        form_data = {
            "resume": (io.BytesIO(pdf_data), "my_resume.pdf"),
            "language": "english",
            "personality": "default",
            "user_id": "test_user_123"
        }

        # Send POST request as multipart form-data
        response = self.app.post(
            '/roast',
            data=form_data,
            content_type='multipart/form-data'
        )

        # Validate response details
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(data.get("success"))
        self.assertIn("roast", data)
        self.assertIsInstance(data.get("ats_score"), int)
        self.assertGreaterEqual(data.get("ats_score"), 0)

    def test_roast_endpoint_missing_file(self):
        """
        Test Case: POST to '/roast' with missing file payload.
        Verifies HTTP 400 Bad Request error checking for missing parameters.
        """
        # POST with missing 'resume' parameter
        response = self.app.post(
            '/roast',
            data={"language": "english", "user_id": "test_user_123"},
            content_type='multipart/form-data'
        )
        self.assertEqual(response.status_code, 400)
        data = json.loads(response.data)
        self.assertIn("error", data)
        self.assertEqual(data.get("error"), "No file uploaded")

    def test_roast_endpoint_invalid_file_extension(self):
        """
        Test Case: POST to '/roast' with an invalid file extension (e.g. .txt).
        Verifies extension checking returns HTTP 400.
        """
        form_data = {
            "resume": (io.BytesIO(b"simple text content"), "resume.txt"),
            "user_id": "test_user_123"
        }
        response = self.app.post(
            '/roast',
            data=form_data,
            content_type='multipart/form-data'
        )
        self.assertEqual(response.status_code, 400)
        data = json.loads(response.data)
        self.assertIn("error", data)
        self.assertEqual(data.get("error"), "Only PDF files are supported.")

if __name__ == '__main__':
    unittest.main()
