using System;

namespace CodeTest
{
    public class Sample
    {

        public int AddNumbers(int a, int b)
        {
            return a + b; 
        }

        // ConcatStrings function summary
        /// <summary>
        /// This method adds two numbers but has an incomplete summary.
        /// </summary>
        public string ConcatStrings(string str1, string str2)
        {
            return str1 + str2; 
        }

        public void ExecuteQuery()
        {
            string query = "SELECT * FROM Users"; 
            Console.WriteLine(query);
        }

        public void PrintMessage()
        {
            Console.WriteLine("Hello World"); 
        }
    }
}
