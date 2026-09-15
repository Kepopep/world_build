# Mythos                                                                    
                                                                  
An Obsidian-style worldbuilding wiki. Each **World** holds a folder tree of 
**Entries** (locations, factions, characters, lore, timelines, maps) written                                                                     
as tagged markdown documents, cross-linked via `[[wikilinks]]` and typed                                                                         
relations, with a graph view over those links.                              
                                                                                   
## Tech stack                                                               
                                                                                    
- **Backend:** Java 21, Spring Boot (Web MVC + Spring Data JPA), Gradle                                                                          
- **Database:** PostgreSQL                                                  
- **Frontend:** plain HTML/CSS/JS (no framework, no bundler)                
                                                                                   
 ## Requirements                                                             
                                                                                   
- JDK 21                                                                    
- PostgreSQL running locally with a `worldBuilding` database                
      (see `src/main/resources/application.properties`)                         
                                                                                                     
